import { randomInt } from 'node:crypto';
import {
  appendJournalSeqWithinTx,
  inTransaction,
  isUniqueViolation,
  isUsableExchangeAddress,
  isValidTronAddress,
  rollback,
  type PoolLike,
  type Queryable,
} from '@broker/money';
import {
  authMailLimited,
  enqueueMail,
  firstNameOf,
  isPlausibleEmail,
  issueEmailVerifyMail,
  issuePasswordResetMail,
  loadSupportSettings,
  normalizeEmail,
  type LinkBuilder,
} from '@broker/support';
import { canEditClientCredentials } from '@/components/shell/sections';
import { asRole } from '../operators/queries';
import { emailChangedNotice, tempPasswordNotice } from './notices';
import {
  CREDENTIAL_ACTIONS,
  DEFAULT_CREDENTIAL_SETTINGS,
  evaluateChecklist,
  maskAddress,
  maskEmail,
  normalizeTicket,
  parseChecklist,
  type ChecklistItem,
  type CredentialSettings,
} from './policy';

/**
 * Правка учётных данных клиента — транзакционное ядро (функция 3, решения
 * владельца 10.11). Образец — `lib/clients/block.ts` и `lib/managers/assign.ts`:
 * одно действие = одна транзакция «смена состояния + письма в очередь + запись
 * в неизменяемый журнал». Письма (`outbound_mail`) пишутся в той же
 * транзакции: откат правки — нет и письма.
 *
 * Кто может (`authorize`, fail-closed, перепроверка В БАЗЕ под транзакцией):
 *  - admin — любого клиента;
 *  - менеджер клиента: роль раздела «Клиенты» + флаг `is_client_manager` +
 *    клиент закреплён именно за ним (`client_managers`);
 *  - остальные — `forbidden`. Автор — из серверной сессии (Р-451).
 *
 * Что пишется в журнал: основание, номер тикета (если указан), снимок
 * чек-листа (формулировки + отметки), значения до/после ТОЛЬКО маскированно.
 * Пароль не попадает никуда, кроме bcrypt-хеша в `users` и одного ответа
 * действию — менеджер видит временный пароль ровно один раз.
 */

/* ─── Общие типы ─────────────────────────────────────────────────────── */

export interface CredentialEditBase {
  /** `operators.id` автора — из серверной сессии, НЕ из формы. */
  actorId: string;
  userId: string;
  basis: string;
  ticket?: string | null;
  /** id отмеченных пунктов чек-листа проверки личности. */
  checks?: readonly string[];
}

export type Fail<R extends string> = { ok: false; reason: R };

type AuthFail = 'forbidden' | 'noClient';
type CommonFail = AuthFail | 'missingReason' | 'checklistRequired' | 'checklistIncomplete';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Actor {
  as: 'admin' | 'manager';
  name: string;
}

interface ClientRow {
  id: string;
  email: string;
  fullName: string;
  locale: string;
  emailVerified: boolean;
}

/**
 * Кто правит: admin или менеджер ЭТОГО клиента; иначе отказ. Строка клиента
 * блокируется (`FOR UPDATE`) — две параллельные правки одного клиента идут
 * по очереди.
 */
async function authorize(tx: Queryable, actorId: string, userId: string): Promise<{ ok: true; actor: Actor; client: ClientRow } | Fail<AuthFail>> {
  if (!UUID_RE.test(actorId) || !UUID_RE.test(userId)) return { ok: false, reason: 'forbidden' };
  const o = await tx.query(
    `SELECT o.role, o.is_client_manager, o.disabled_at, o.display_name,
            (SELECT cm.manager_id FROM client_managers cm WHERE cm.user_id = $2) AS manager_id
       FROM operators o WHERE o.id = $1`,
    [actorId, userId],
  );
  const op = o.rows[0];
  if (!op || op.disabled_at) return { ok: false, reason: 'forbidden' };
  let role;
  try {
    role = asRole(String(op.role));
  } catch {
    return { ok: false, reason: 'forbidden' };
  }
  const isAssignedManager =
    Boolean(op.is_client_manager) && String(op.manager_id ?? '').toLowerCase() === actorId.toLowerCase();
  if (!canEditClientCredentials(role, { isAssignedManager })) return { ok: false, reason: 'forbidden' };

  const u = await tx.query(
    `SELECT id, email, full_name, locale, email_verified_at FROM users WHERE id = $1 FOR UPDATE`,
    [userId],
  );
  const row = u.rows[0];
  if (!row) return { ok: false, reason: 'noClient' };
  return {
    ok: true,
    actor: { as: role === 'admin' ? 'admin' : 'manager', name: String(op.display_name) },
    client: {
      id: String(row.id),
      email: String(row.email),
      fullName: String(row.full_name),
      locale: String(row.locale ?? 'ru'),
      emailVerified: row.email_verified_at !== null && row.email_verified_at !== undefined,
    },
  };
}

/* ─── Настройки ──────────────────────────────────────────────────────── */

export async function readCredentialSettings(db: Queryable): Promise<CredentialSettings> {
  const r = await db.query(
    `SELECT checklist, min_checked, auto_hold_enabled, auto_hold_hours, alert_per_operator_day, temp_password_hours
       FROM platform_credential_settings WHERE id = 1`,
  );
  const row = r.rows[0];
  if (!row) return { ...DEFAULT_CREDENTIAL_SETTINGS };
  const raw = typeof row.checklist === 'string' ? (JSON.parse(row.checklist) as unknown) : row.checklist;
  return {
    checklist: parseChecklist(raw),
    minChecked: Number(row.min_checked),
    autoHoldEnabled: Boolean(row.auto_hold_enabled),
    autoHoldHours: Number(row.auto_hold_hours),
    alertPerOperatorDay: Number(row.alert_per_operator_day),
    tempPasswordHours: Number(row.temp_password_hours),
  };
}

/* ─── Общий пролог правки ────────────────────────────────────────────── */

interface Prologue {
  actor: Actor;
  client: ClientRow;
  settings: CredentialSettings;
  common: { basis: string; ticket: string | null; checklist: { id: string; label: string; checked: boolean }[]; actorAs: 'admin' | 'manager' };
}

async function prologue(tx: Queryable, input: CredentialEditBase, withChecklist: boolean): Promise<{ ok: true; p: Prologue } | Fail<CommonFail>> {
  const basis = input.basis?.trim() ?? '';
  const auth = await authorize(tx, input.actorId, input.userId);
  if (!auth.ok) return auth;
  if (!basis) return { ok: false, reason: 'missingReason' };
  const settings = await readCredentialSettings(tx);
  let checklist: Prologue['common']['checklist'] = [];
  if (withChecklist) {
    const v = evaluateChecklist(settings, input.checks ?? []);
    if (!v.ok) return { ok: false, reason: v.reason };
    checklist = v.marks;
  }
  return {
    ok: true,
    p: {
      actor: auth.actor,
      client: auth.client,
      settings,
      common: { basis, ticket: normalizeTicket(input.ticket), checklist, actorAs: auth.actor.as },
    },
  };
}

function journal(tx: Queryable, actorId: string, action: string, userId: string, payload: Record<string, unknown>): Promise<number> {
  return appendJournalSeqWithinTx({ operatorId: actorId, action, subjectKind: 'client', subjectId: userId, payload }, tx);
}

/* ─── Заморозка вывода (тот же флаг «Запрет вывода») ──────────────────── */

interface BanRow {
  active: boolean;
  until: Date | null;
  kind: 'money_flags' | 'credentials_manual' | 'credentials_auto';
}

async function lockBan(tx: Queryable, userId: string): Promise<BanRow> {
  await tx.query(`INSERT INTO client_money_flags (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [userId]);
  const r = await tx.query(
    `SELECT withdraw_banned, withdraw_ban_until, withdraw_ban_kind,
            (withdraw_banned AND (withdraw_ban_until IS NULL OR withdraw_ban_until > now())) AS active
       FROM client_money_flags WHERE user_id = $1 FOR UPDATE`,
    [userId],
  );
  const row = r.rows[0]!;
  const kind = row.withdraw_ban_kind === 'credentials_manual' || row.withdraw_ban_kind === 'credentials_auto' ? row.withdraw_ban_kind : 'money_flags';
  return {
    active: Boolean(row.active),
    until: row.withdraw_ban_until ? new Date(row.withdraw_ban_until as string) : null,
    kind,
  };
}

async function writeBan(
  tx: Queryable,
  userId: string,
  actorId: string,
  next: { banned: boolean; until: Date | null; kind: BanRow['kind'] | null; reason: string | null },
): Promise<void> {
  await tx.query(
    `UPDATE client_money_flags
        SET withdraw_banned = $2, withdraw_ban_until = $3, withdraw_ban_kind = $4, withdraw_ban_reason = $5,
            updated_at = now(), updated_by = $6
      WHERE user_id = $1`,
    [userId, next.banned, next.until, next.kind, next.reason, actorId],
  );
}

/**
 * Автозаморозка вывода после смены email / временного пароля — если включена
 * в настройках. Существующий запрет не СОКРАЩАЕТСЯ: бессрочный или более
 * долгий остаётся как есть (в журнал — что автозаморозка не понадобилась).
 */
async function applyAutoHold(
  tx: Queryable,
  settings: CredentialSettings,
  input: { actorId: string; userId: string; cause: string; now: Date },
): Promise<{ until: string; applied: boolean } | null> {
  if (!settings.autoHoldEnabled) return null;
  const until = new Date(input.now.getTime() + settings.autoHoldHours * 3_600_000);
  const ban = await lockBan(tx, input.userId);
  if (ban.active && (ban.until === null || ban.until >= until)) {
    return { until: ban.until ? ban.until.toISOString() : 'indefinite', applied: false };
  }
  const reason = `Автозаморозка вывода на ${settings.autoHoldHours} ч после правки учётных данных`;
  await writeBan(tx, input.userId, input.actorId, {
    banned: true,
    until,
    kind: ban.active ? ban.kind : 'credentials_auto',
    reason,
  });
  const seq = await journal(tx, input.actorId, CREDENTIAL_ACTIONS.holdAutoSet, input.userId, {
    basis: reason,
    cause: input.cause,
    hours: settings.autoHoldHours,
    until: until.toISOString(),
  });
  await tx.query(`UPDATE client_money_flags SET last_journal_seq = $2 WHERE user_id = $1`, [input.userId, seq]);
  return { until: until.toISOString(), applied: true };
}

/* ─── Смена email ────────────────────────────────────────────────────── */

export type EmailChangeResult =
  | { ok: true; autoHoldUntil: string | null }
  | Fail<CommonFail | 'invalidEmail' | 'sameEmail' | 'emailTaken' | 'linkUnavailable'>;

/**
 * Менеджер меняет email СРАЗУ (владелец доверяет менеджеру, ожидания клика
 * клиента нет). Новый адрес — неподтверждённый, на него уходит письмо
 * подтверждения; на СТАРЫЙ — уведомление «email изменён менеджером». Живые
 * ссылки сброса/подтверждения, ушедшие на старый адрес, гасятся.
 */
export async function changeClientEmail(
  input: CredentialEditBase & { newEmail: string },
  deps: { pool: PoolLike; link: LinkBuilder | null; now?: Date },
): Promise<EmailChangeResult> {
  const newEmail = normalizeEmail(input.newEmail ?? '');
  if (!isPlausibleEmail(newEmail) || newEmail.length > 254) return { ok: false, reason: 'invalidEmail' };
  const now = deps.now ?? new Date();
  try {
    return await inTransaction<EmailChangeResult>(deps.pool, async (tx) => {
      const pr = await prologue(tx, input, true);
      if (!pr.ok) return rollback<EmailChangeResult>(pr);
      const { client, settings, common } = pr.p;
      if (normalizeEmail(client.email) === newEmail) return rollback<EmailChangeResult>({ ok: false, reason: 'sameEmail' });
      if (!deps.link) return rollback<EmailChangeResult>({ ok: false, reason: 'linkUnavailable' });
      const taken = await tx.query(`SELECT 1 FROM users WHERE lower(email) = $1 AND id <> $2`, [newEmail, client.id]);
      if (taken.rows.length > 0) return rollback<EmailChangeResult>({ ok: false, reason: 'emailTaken' });

      await tx.query(`UPDATE users SET email = $2, email_verified_at = NULL WHERE id = $1`, [client.id, newEmail]);
      // Ссылки, ушедшие на прежний адрес, больше не действуют.
      const revoked = await tx.query(
        `UPDATE auth_mail_tokens SET used_at = $2 WHERE user_id = $1 AND used_at IS NULL AND token_hash IS NOT NULL RETURNING id`,
        [client.id, now],
      );

      const support = await loadSupportSettings(tx);
      const firstName = firstNameOf(client.fullName);
      await issueEmailVerifyMail(tx, support, {
        user: { id: client.id, email: newEmail, fullName: client.fullName, locale: client.locale },
        link: deps.link,
        ip: null,
        now,
      });
      const notice = emailChangedNotice({ locale: client.locale, firstName, newEmailMasked: maskEmail(newEmail), ticket: common.ticket });
      await enqueueMail(tx, { purpose: 'credentials_notice', to: client.email, subject: notice.subject, bodyText: notice.body });

      const hold = await applyAutoHold(tx, settings, { actorId: input.actorId, userId: client.id, cause: 'email', now });
      await journal(tx, input.actorId, CREDENTIAL_ACTIONS.emailChanged, client.id, {
        ...common,
        before: maskEmail(client.email),
        after: maskEmail(newEmail),
        previousVerified: client.emailVerified,
        verificationSentToNew: true,
        noticeSentToOld: true,
        linksRevoked: revoked.rows.length,
        autoHold: hold,
      });
      return { ok: true, autoHoldUntil: hold?.applied ? hold.until : null };
    });
  } catch (error) {
    // Гонка: тот же email заняли между проверкой и UPDATE (уникальный индекс).
    if (isUniqueViolation(error)) return { ok: false, reason: 'emailTaken' };
    throw error;
  }
}

/* ─── Ссылка сброса пароля ───────────────────────────────────────────── */

export type ResetLinkResult = { ok: true; sentTo: string } | Fail<CommonFail | 'linkUnavailable' | 'rateLimited'>;

/** Существующий механизм сброса (`auth_mail_tokens`): ссылка уходит на текущий email клиента. */
export async function sendPasswordResetLink(
  input: CredentialEditBase,
  deps: { pool: PoolLike; link: LinkBuilder | null; now?: Date },
): Promise<ResetLinkResult> {
  const now = deps.now ?? new Date();
  return inTransaction<ResetLinkResult>(deps.pool, async (tx) => {
    const pr = await prologue(tx, input, true);
    if (!pr.ok) return rollback<ResetLinkResult>(pr);
    const { client, common } = pr.p;
    if (!deps.link) return rollback<ResetLinkResult>({ ok: false, reason: 'linkUnavailable' });
    const email = normalizeEmail(client.email);
    if (await authMailLimited(tx, 'password_reset', email, null, now)) return rollback<ResetLinkResult>({ ok: false, reason: 'rateLimited' });
    const support = await loadSupportSettings(tx);
    await issuePasswordResetMail(tx, support, {
      user: { id: client.id, email, fullName: client.fullName, locale: client.locale },
      link: deps.link,
      ip: null,
      now,
    });
    await journal(tx, input.actorId, CREDENTIAL_ACTIONS.resetLinkSent, client.id, {
      ...common,
      to: maskEmail(email),
      emailVerified: client.emailVerified,
    });
    return { ok: true, sentTo: maskEmail(email) };
  });
}

/* ─── Временный пароль ───────────────────────────────────────────────── */

/** Без похожих символов (0/O, 1/l/I): менеджер диктует пароль по телефону. */
const TEMP_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateTempPassword(length = 12): string {
  for (;;) {
    let s = '';
    for (let i = 0; i < length; i++) s += TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)];
    if (/[a-z]/.test(s) && /[A-Z]/.test(s) && /[2-9]/.test(s)) return s;
  }
}

export type TempPasswordResult =
  | { ok: true; password: string; expiresAt: string; sessionsRevoked: number; autoHoldUntil: string | null }
  | Fail<CommonFail>;

/**
 * Временный пароль: генерирует система, показывается менеджеру ОДИН раз
 * (возвращается только из этого вызова). Клиент обязан сменить его при входе
 * (`password_must_change`), срок — из настроек; все сессии гасятся, живые
 * ссылки сброса — тоже. Хеш считает вызывающий тем же алгоритмом, что кабинет.
 */
export async function issueTemporaryPassword(
  input: CredentialEditBase,
  deps: { pool: PoolLike; hash: (password: string) => Promise<string>; now?: Date; generate?: () => string },
): Promise<TempPasswordResult> {
  const now = deps.now ?? new Date();
  const password = (deps.generate ?? generateTempPassword)();
  const passwordHash = await deps.hash(password);
  return inTransaction<TempPasswordResult>(deps.pool, async (tx) => {
    const pr = await prologue(tx, input, true);
    if (!pr.ok) return rollback<TempPasswordResult>(pr);
    const { client, settings, common } = pr.p;
    const expiresAt = new Date(now.getTime() + settings.tempPasswordHours * 3_600_000);
    await tx.query(
      `UPDATE users SET password_hash = $2, password_must_change = true, temp_password_expires_at = $3 WHERE id = $1`,
      [client.id, passwordHash, expiresAt],
    );
    const sessions = await tx.query(`DELETE FROM sessions WHERE user_id = $1 RETURNING id`, [client.id]);
    await tx.query(
      `UPDATE auth_mail_tokens SET used_at = $2 WHERE user_id = $1 AND purpose = 'password_reset' AND used_at IS NULL`,
      [client.id, now],
    );
    const notice = tempPasswordNotice({ locale: client.locale, firstName: firstNameOf(client.fullName), ticket: common.ticket });
    await enqueueMail(tx, { purpose: 'credentials_notice', to: client.email, subject: notice.subject, bodyText: notice.body });
    const hold = await applyAutoHold(tx, settings, { actorId: input.actorId, userId: client.id, cause: 'temp_password', now });
    await journal(tx, input.actorId, CREDENTIAL_ACTIONS.tempPasswordIssued, client.id, {
      ...common,
      expiresAt: expiresAt.toISOString(),
      mustChange: true,
      sessionsRevoked: sessions.rows.length,
      noticeSentTo: maskEmail(client.email),
      autoHold: hold,
    });
    return {
      ok: true,
      password,
      expiresAt: expiresAt.toISOString(),
      sessionsRevoked: sessions.rows.length,
      autoHoldUntil: hold?.applied ? hold.until : null,
    };
  });
}

/* ─── Адрес в заявке на вывод ────────────────────────────────────────── */

export type AddressFixResult =
  | { ok: true; before: string; after: string }
  | Fail<CommonFail | 'invalidAddress' | 'contractAddress' | 'noWithdrawal' | 'withdrawalNotEditable' | 'sameAddress'>;

/**
 * Исправить адрес получателя в заявке на вывод, которая ещё не ушла в сеть
 * (`requested`/`approved`, хэша отправки нет) — типичный случай «клиент ошибся
 * адресом». Адресной книги нет (решение владельца 10.11): адрес живёт только
 * в заявке. Проверка — base58check TRON и запрет адреса контракта USDT.
 */
export async function fixWithdrawalAddress(
  input: CredentialEditBase & { withdrawalId: string; newAddress: string },
  deps: { pool: PoolLike },
): Promise<AddressFixResult> {
  const address = (input.newAddress ?? '').trim();
  if (!isValidTronAddress(address)) return { ok: false, reason: 'invalidAddress' };
  if (!isUsableExchangeAddress(address)) return { ok: false, reason: 'contractAddress' };
  if (!UUID_RE.test(input.withdrawalId ?? '')) return { ok: false, reason: 'noWithdrawal' };
  return inTransaction<AddressFixResult>(deps.pool, async (tx) => {
    const pr = await prologue(tx, input, true);
    if (!pr.ok) return rollback<AddressFixResult>(pr);
    const { client, common } = pr.p;
    const w = await tx.query(
      `SELECT id, status, to_address, payout_tx_hash, amount_minor FROM crypto_withdrawals
        WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [input.withdrawalId, client.id],
    );
    const row = w.rows[0];
    if (!row) return rollback<AddressFixResult>({ ok: false, reason: 'noWithdrawal' });
    if (!['requested', 'approved'].includes(String(row.status)) || row.payout_tx_hash) {
      return rollback<AddressFixResult>({ ok: false, reason: 'withdrawalNotEditable' });
    }
    if (String(row.to_address) === address) return rollback<AddressFixResult>({ ok: false, reason: 'sameAddress' });
    await tx.query(`UPDATE crypto_withdrawals SET to_address = $2, updated_at = now() WHERE id = $1`, [row.id, address]);
    const before = maskAddress(String(row.to_address));
    const after = maskAddress(address);
    const seq = await journal(tx, input.actorId, CREDENTIAL_ACTIONS.withdrawalAddressChanged, client.id, {
      ...common,
      withdrawalId: String(row.id),
      withdrawalStatus: String(row.status),
      amountMinor: Number(row.amount_minor),
      before,
      after,
    });
    await tx.query(`UPDATE crypto_withdrawals SET last_journal_seq = $2 WHERE id = $1`, [row.id, seq]);
    return { ok: true, before, after };
  });
}

/* ─── Заморозка вывода по распоряжению менеджера ─────────────────────── */

export const MAX_HOLD_DAYS = 366;

export type HoldSetResult = { ok: true; until: string | null } | Fail<AuthFail | 'missingReason' | 'invalidUntil' | 'bannedByFinance'>;

/** Заморозить вывод: срок (`until`) или бессрочно (`null`). Повтор — продлевает/меняет срок. */
export async function setWithdrawHold(
  input: { actorId: string; userId: string; basis: string; until: Date | null; ticket?: string | null },
  deps: { pool: PoolLike; now?: Date },
): Promise<HoldSetResult> {
  const now = deps.now ?? new Date();
  if (input.until && (!(input.until.getTime() > now.getTime()) || input.until.getTime() - now.getTime() > MAX_HOLD_DAYS * 86_400_000)) {
    return { ok: false, reason: 'invalidUntil' };
  }
  return inTransaction<HoldSetResult>(deps.pool, async (tx) => {
    const pr = await prologue(tx, input, false);
    if (!pr.ok) return rollback<HoldSetResult>(pr as Fail<AuthFail | 'missingReason'>);
    const { client, common } = pr.p;
    const ban = await lockBan(tx, client.id);
    // Бессрочный запрет финансов не перекрываем сроком — иначе он «истёк» бы сам.
    if (ban.active && ban.kind === 'money_flags') return rollback<HoldSetResult>({ ok: false, reason: 'bannedByFinance' });
    await writeBan(tx, client.id, input.actorId, { banned: true, until: input.until, kind: 'credentials_manual', reason: common.basis });
    const seq = await journal(tx, input.actorId, CREDENTIAL_ACTIONS.holdSet, client.id, {
      basis: common.basis,
      ticket: common.ticket,
      actorAs: common.actorAs,
      until: input.until ? input.until.toISOString() : null,
      previous: ban.active ? { kind: ban.kind, until: ban.until ? ban.until.toISOString() : null } : null,
    });
    await tx.query(`UPDATE client_money_flags SET last_journal_seq = $2 WHERE user_id = $1`, [client.id, seq]);
    return { ok: true, until: input.until ? input.until.toISOString() : null };
  });
}

export type HoldLiftResult = { ok: true } | Fail<AuthFail | 'missingReason' | 'noHold' | 'notCredentialsHold'>;

/**
 * Снять заморозку вручную (своё распоряжение или автозаморозку). Запрет из
 * денежных флагов (финансы/комплаенс) отсюда не снимается — только там.
 */
export async function liftWithdrawHold(
  input: { actorId: string; userId: string; basis: string; ticket?: string | null },
  deps: { pool: PoolLike },
): Promise<HoldLiftResult> {
  return inTransaction<HoldLiftResult>(deps.pool, async (tx) => {
    const pr = await prologue(tx, input, false);
    if (!pr.ok) return rollback<HoldLiftResult>(pr as Fail<AuthFail | 'missingReason'>);
    const { client, common } = pr.p;
    const ban = await lockBan(tx, client.id);
    if (!ban.active) return rollback<HoldLiftResult>({ ok: false, reason: 'noHold' });
    if (ban.kind === 'money_flags') return rollback<HoldLiftResult>({ ok: false, reason: 'notCredentialsHold' });
    await writeBan(tx, client.id, input.actorId, { banned: false, until: null, kind: null, reason: null });
    const seq = await journal(tx, input.actorId, CREDENTIAL_ACTIONS.holdLifted, client.id, {
      basis: common.basis,
      ticket: common.ticket,
      actorAs: common.actorAs,
      kind: ban.kind,
      until: ban.until ? ban.until.toISOString() : null,
    });
    await tx.query(`UPDATE client_money_flags SET last_journal_seq = $2 WHERE user_id = $1`, [client.id, seq]);
    return { ok: true };
  });
}

/* ─── Настройки (только admin; роль проверяет action) ─────────────────── */

export type SettingsResult = { ok: true } | Fail<'missingReason' | 'invalidSettings' | 'noChange'>;

export async function updateCredentialSettings(
  input: { actorId: string; basis: string; next: CredentialSettings },
  deps: { pool: PoolLike },
): Promise<SettingsResult> {
  const basis = input.basis?.trim() ?? '';
  if (!basis) return { ok: false, reason: 'missingReason' };
  const n = input.next;
  const intIn = (v: number, lo: number, hi: number) => Number.isInteger(v) && v >= lo && v <= hi;
  if (
    n.checklist.length === 0 ||
    !intIn(n.minChecked, 0, 20) ||
    !intIn(n.autoHoldHours, 1, 720) ||
    !intIn(n.alertPerOperatorDay, 1, 1000) ||
    !intIn(n.tempPasswordHours, 1, 168)
  ) {
    return { ok: false, reason: 'invalidSettings' };
  }
  return inTransaction<SettingsResult>(deps.pool, async (tx) => {
    await tx.query(`INSERT INTO platform_credential_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
    await tx.query(`SELECT id FROM platform_credential_settings WHERE id = 1 FOR UPDATE`);
    const before = await readCredentialSettings(tx);
    if (JSON.stringify(before) === JSON.stringify(n)) return rollback<SettingsResult>({ ok: false, reason: 'noChange' });
    await tx.query(
      `UPDATE platform_credential_settings
          SET checklist = $1::jsonb, min_checked = $2, auto_hold_enabled = $3, auto_hold_hours = $4,
              alert_per_operator_day = $5, temp_password_hours = $6, updated_at = now(), updated_by = $7
        WHERE id = 1`,
      [JSON.stringify(n.checklist satisfies ChecklistItem[]), n.minChecked, n.autoHoldEnabled, n.autoHoldHours, n.alertPerOperatorDay, n.tempPasswordHours, input.actorId],
    );
    const seq = await appendJournalSeqWithinTx(
      {
        operatorId: input.actorId,
        action: CREDENTIAL_ACTIONS.settingsUpdated,
        subjectKind: 'platform',
        subjectId: 'platform:credential_settings',
        payload: { basis, before, after: n },
      },
      tx,
    );
    await tx.query(`UPDATE platform_credential_settings SET last_journal_seq = $1 WHERE id = 1`, [seq]);
    return { ok: true };
  });
}
