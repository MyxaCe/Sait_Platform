import { createHash, randomBytes } from 'node:crypto';
import { inTransaction, type PoolLike, type Queryable } from '@broker/money';
import { enqueueMail } from '@broker/support';
import {
  TRANSFER_ACTIONS,
  TRANSFER_SYSTEM_OPERATOR,
  iso,
  journal,
  setMoneyFlagsWithinTx,
  type TransferTerminalPort,
} from './common';
import { dedupeKey, enqueueMessage, type PackageData, type RevokeData, type StatusData } from './messages';
import { targetAcceptance } from './policy';
import { getGroupPlatform, type GroupPlatform } from './registry';

/**
 * Цель: входящий перевод — ПРИГЛАШЕНИЕ, а не счёт. Клиент получает письмо от
 * бренда цели со ссылкой регистрации (предзаполнение только согласованных
 * полей), сам принимает оферту и проходит KYC заново. Статусы уходят
 * источнику подписанными сообщениями `transfer.status`.
 */

export const INVITE_TTL_DAYS = 30;

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Ссылка регистрации: next-intl, ru — без префикса, en — `/en`. */
export function inviteLink(cabinetUrl: string, locale: 'ru' | 'en', token: string): string {
  const base = cabinetUrl.replace(/\/+$/, '');
  return `${base}${locale === 'en' ? '/en' : ''}/register?invite=${encodeURIComponent(token)}`;
}

function inviteMail(input: {
  locale: 'ru' | 'en';
  firstName: string;
  self: GroupPlatform;
  source: GroupPlatform;
  link: string;
  number: string;
}): { subject: string; body: string } {
  const { self, source } = input;
  if (input.locale === 'en') {
    return {
      subject: `${self.name}: your invitation to open an account (transfer ${input.number})`,
      body: [
        `Hello${input.firstName ? `, ${input.firstName}` : ''}!`,
        '',
        `At your request sent to ${source.name} support, ${source.name} passed us your name, email, country and language so that you can open an account with ${self.name}${self.legalEntity ? ` (${self.legalEntity})` : ''}.`,
        '',
        `Register yourself using this link (valid for ${INVITE_TTL_DAYS} days):`,
        input.link,
        '',
        `${self.name} operates under its own jurisdiction and terms: you will accept our client agreement and pass identity verification (KYC) again. Your funds are not moved automatically — withdraw them from ${source.name} in the usual way and deposit to your new account.`,
        '',
        `If you did not ask for this transfer, ignore this email and tell ${source.name} support.`,
      ].join('\n'),
    };
  }
  return {
    subject: `${self.name}: приглашение открыть счёт (перевод ${input.number})`,
    body: [
      `Здравствуйте${input.firstName ? `, ${input.firstName}` : ''}!`,
      '',
      `По вашему заявлению в поддержку ${source.name} платформа ${source.name} передала нам ваши ФИО, email, страну и язык, чтобы вы могли открыть счёт в ${self.name}${self.legalEntity ? ` (${self.legalEntity})` : ''}.`,
      '',
      `Зарегистрируйтесь сами по ссылке (действует ${INVITE_TTL_DAYS} дней):`,
      input.link,
      '',
      `${self.name} работает в своей юрисдикции и на своих условиях: вы примете нашу оферту и пройдёте проверку личности (KYC) заново. Средства автоматически не переносятся — выведите их из ${source.name} обычной заявкой на вывод и пополните новый счёт.`,
      '',
      `Если вы не просили о переводе, просто проигнорируйте письмо и сообщите в поддержку ${source.name}.`,
    ].join('\n'),
  };
}

export type ReceivePackageOutcome =
  | { result: 'accepted' | 'duplicate' }
  | { result: 'refused'; code: string; retryable?: boolean };

/** Приём пакета внутри транзакции приёмника (подпись/nonce уже проверены). */
export async function receivePackageWithinTx(
  tx: Queryable,
  input: { transferId: string; from: string; data: PackageData; packageSha256: string; selfSlug: string; now: Date },
): Promise<ReceivePackageOutcome> {
  const d = input.data;
  if (d.sourcePlatform !== input.from) return { result: 'refused', code: 'senderMismatch' };
  if (!d.client?.email || !d.client?.fullName || !d.number) return { result: 'refused', code: 'malformedPackage' };

  // Возврат пришёл раньше пакета (гонка доставки) — пакет не принимаем.
  const tomb = await tx.query(`SELECT 1 FROM platform_transfer_inbox WHERE dedupe_key = $1`, [
    dedupeKey(input.transferId, 'transfer.revoke'),
  ]);
  if (tomb.rows.length) return { result: 'refused', code: 'revoked' };

  const existing = await tx.query(`SELECT package_sha256 FROM platform_transfers_inbound WHERE transfer_id = $1`, [
    input.transferId,
  ]);
  if (existing.rows[0]) {
    return existing.rows[0].package_sha256 === input.packageSha256
      ? { result: 'duplicate' }
      : { result: 'refused', code: 'conflictingPackage' };
  }

  const [self, source] = await Promise.all([getGroupPlatform(tx, input.selfSlug), getGroupPlatform(tx, input.from)]);
  const refusal = targetAcceptance(self, d.client.country);
  if (refusal) return { result: 'refused', code: refusal, retryable: refusal === 'selfNotRegistered' };
  if (!self || !source) return { result: 'refused', code: 'selfNotRegistered', retryable: true };

  const token = randomBytes(32).toString('base64url');
  const locale = d.client.locale === 'en' ? 'en' : 'ru';
  const expiresAt = new Date(input.now.getTime() + INVITE_TTL_DAYS * 86_400_000);
  const mail = inviteMail({
    locale,
    firstName: d.client.fullName.trim().split(/\s+/)[0] ?? '',
    self,
    source,
    link: inviteLink(self.cabinetUrl, locale, token),
    number: d.number,
  });
  const mailId = await enqueueMail(tx, {
    purpose: 'transfer_invite',
    to: d.client.email,
    subject: mail.subject,
    bodyText: mail.body,
    expiresAt,
  });
  await tx.query(
    `INSERT INTO platform_transfers_inbound (transfer_id, number, source_platform, package_sha256, full_name, email,
       country, locale, source_kyc_state, source_kyc_at, evidence_sha256, consent_at, consent_text_version, status,
       invite_token_hash, invite_expires_at, invite_mail_id, received_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'received', $14, $15, $16, $17, $17)`,
    [
      input.transferId,
      d.number,
      input.from,
      input.packageSha256,
      d.client.fullName,
      d.client.email.trim(),
      d.client.country,
      locale,
      d.sourceKyc?.state ?? null,
      d.sourceKyc?.at ?? null,
      d.evidence.sha256,
      d.consent.at,
      d.consent.textVersion,
      hashInviteToken(token),
      expiresAt,
      mailId,
      input.now,
    ],
  );
  await journal(tx, {
    operatorId: TRANSFER_SYSTEM_OPERATOR,
    action: TRANSFER_ACTIONS.received,
    subjectKind: 'platform_transfer',
    subjectId: input.transferId,
    payload: {
      number: d.number,
      source: input.from,
      packageSha256: input.packageSha256,
      evidenceSha256: d.evidence.sha256,
      consentTextVersion: d.consent.textVersion,
      sourceKycState: d.sourceKyc?.state ?? null,
    },
  });
  const seq = await journal(tx, {
    operatorId: TRANSFER_SYSTEM_OPERATOR,
    action: TRANSFER_ACTIONS.inviteQueued,
    subjectKind: 'platform_transfer',
    subjectId: input.transferId,
    payload: { number: d.number, mailId, expiresAt: expiresAt.toISOString() },
  });
  await tx.query(`UPDATE platform_transfers_inbound SET last_journal_seq = $2 WHERE transfer_id = $1`, [input.transferId, seq]);
  return { result: 'accepted' };
}

function noticeMail(locale: 'ru' | 'en', self: GroupPlatform, number: string): { subject: string; body: string } {
  if (locale === 'en') {
    return {
      subject: `${self.name}: your account is suspended (transfer ${number} withdrawn)`,
      body: [
        'Hello!',
        '',
        `The group has withdrawn transfer ${number}, under which you opened an account with ${self.name}. Trading and withdrawals on this account are suspended.`,
        'If you have already deposited funds, our manager will contact you to return them by a regular withdrawal.',
        `Your account with the original platform remains active. Questions — reply to this email or contact ${self.name} support.`,
      ].join('\n'),
    };
  }
  return {
    subject: `${self.name}: счёт приостановлен (перевод ${number} отозван)`,
    body: [
      'Здравствуйте!',
      '',
      `Группа отозвала перевод ${number}, по которому вы открыли счёт в ${self.name}. Торговля и вывод на этом счёте приостановлены.`,
      'Если вы уже пополнили счёт, наш менеджер свяжется с вами и вернёт средства обычной заявкой на вывод.',
      `Ваш счёт на исходной платформе остаётся активным. Вопросы — ответьте на это письмо или напишите в поддержку ${self.name}.`,
    ].join('\n'),
  };
}

/**
 * Возврат перевода в цели (сообщение `transfer.revoke` от источника).
 *  - клиент не зарегистрирован → приглашение отзывается (токен стёрт, письмо
 *    в очереди отменено);
 *  - зарегистрирован → счёт замораживается (заморозка + запрет вывода, те же
 *    флаги и коды журнала, что у формы «Деньги»), торговля — через терминал
 *    повтором воркера, клиенту письмо; если были зачисления — задача менеджеру
 *    цели «вернуть средства выводом». Деньги автоматически не двигаются.
 */
export async function receiveRevokeWithinTx(
  tx: Queryable,
  input: { transferId: string; from: string; data: RevokeData; selfSlug: string; now: Date },
): Promise<{ result: 'accepted'; stage: 'before_registration' | 'after_registration' | 'unknown_transfer' } | { result: 'refused'; code: string }> {
  const r = await tx.query(
    `SELECT transfer_id, number, source_platform, status, registered_user_id, invite_mail_id, locale, email
       FROM platform_transfers_inbound WHERE transfer_id = $1 FOR UPDATE`,
    [input.transferId],
  );
  const row = r.rows[0];
  const status: StatusData = {
    number: input.data.number,
    event: 'revoke_applied',
    at: input.now.toISOString(),
    detail: {},
  };
  if (!row) {
    // Пакета не было (или он ещё в пути): надгробие в inbox уже записано —
    // пришедший позже пакет будет отвергнут.
    status.detail = { stage: 'unknown_transfer' };
    await enqueueMessage(tx, { transferId: input.transferId, to: input.from, kind: 'transfer.status', data: status, event: 'revoke_applied' });
    return { result: 'accepted', stage: 'unknown_transfer' };
  }
  if (String(row.source_platform) !== input.from) return { result: 'refused', code: 'senderMismatch' };
  if (row.status === 'revoked') return { result: 'accepted', stage: row.registered_user_id ? 'after_registration' : 'before_registration' };

  const basis = `Перевод ${row.number} отозван группой (источник ${input.from}): ${input.data.basis}`;
  if (!row.registered_user_id) {
    await tx.query(
      `UPDATE platform_transfers_inbound SET status = 'revoked', invite_token_hash = NULL, revoked_at = $2, revoke_basis = $3, updated_at = $2
        WHERE transfer_id = $1`,
      [input.transferId, input.now, input.data.basis],
    );
    if (row.invite_mail_id) {
      await tx.query(`UPDATE outbound_mail SET status = 'cancelled', body_text = NULL WHERE id = $1 AND status = 'queued'`, [
        row.invite_mail_id,
      ]);
    }
    const seq = await journal(tx, {
      operatorId: TRANSFER_SYSTEM_OPERATOR,
      action: TRANSFER_ACTIONS.inviteRevoked,
      subjectKind: 'platform_transfer',
      subjectId: input.transferId,
      payload: { basis, number: String(row.number), source: input.from },
    });
    await tx.query(`UPDATE platform_transfers_inbound SET last_journal_seq = $2 WHERE transfer_id = $1`, [input.transferId, seq]);
    status.detail = { stage: 'before_registration', inviteRevoked: true };
    await enqueueMessage(tx, { transferId: input.transferId, to: input.from, kind: 'transfer.status', data: status, event: 'revoke_applied' });
    return { result: 'accepted', stage: 'before_registration' };
  }

  const userId = String(row.registered_user_id);
  await setMoneyFlagsWithinTx(tx, {
    userId,
    operatorId: TRANSFER_SYSTEM_OPERATOR,
    basis,
    transferId: input.transferId,
    frozen: true,
    withdrawBanned: true,
  });
  const dep = await tx.query(`SELECT count(*)::int AS n FROM crypto_deposits WHERE user_id = $1 AND status = 'credited'`, [userId]);
  const funds = Number(dep.rows[0]?.n ?? 0) > 0;
  const self = await getGroupPlatform(tx, input.selfSlug);
  if (self) {
    const m = noticeMail(row.locale === 'en' ? 'en' : 'ru', self, String(row.number));
    const u = await tx.query(`SELECT email FROM users WHERE id = $1`, [userId]);
    await enqueueMail(tx, { purpose: 'transfer_notice', to: String(u.rows[0]?.email ?? row.email), subject: m.subject, bodyText: m.body });
  }
  await tx.query(
    `UPDATE platform_transfers_inbound SET status = 'revoked', revoked_at = $2, revoke_basis = $3, freeze_state = 'pending',
            refund_task = CASE WHEN $4::boolean THEN 'open' ELSE 'none' END, updated_at = $2
      WHERE transfer_id = $1`,
    [input.transferId, input.now, input.data.basis, funds],
  );
  const seq = await journal(tx, {
    operatorId: TRANSFER_SYSTEM_OPERATOR,
    action: TRANSFER_ACTIONS.revokedByGroup,
    subjectKind: 'client',
    subjectId: userId,
    payload: { basis, transferId: input.transferId, number: String(row.number), source: input.from, fundsOnTarget: funds, refundTask: funds },
  });
  await tx.query(`UPDATE platform_transfers_inbound SET last_journal_seq = $2 WHERE transfer_id = $1`, [input.transferId, seq]);
  status.detail = { stage: 'after_registration', accountFrozen: true, fundsOnTarget: funds };
  await enqueueMessage(tx, { transferId: input.transferId, to: input.from, kind: 'transfer.status', data: status, event: 'revoke_applied' });
  return { result: 'accepted', stage: 'after_registration' };
}

/* ── Регистрация по приглашению (кабинет цели) ────────────────────────── */

export interface InvitePrefill {
  transferId: string;
  number: string;
  sourcePlatform: string;
  sourceName: string;
  firstName: string;
  lastName: string;
  email: string;
  country: string | null;
  locale: 'ru' | 'en';
}

export type InviteInspection = { ok: true; prefill: InvitePrefill } | { ok: false; reason: 'invalid' | 'expired' | 'used' | 'revoked' };

export async function inspectInvite(db: Queryable, token: string, now = new Date()): Promise<InviteInspection> {
  if (!token || token.length > 200) return { ok: false, reason: 'invalid' };
  const r = await db.query(
    `SELECT i.transfer_id, i.number, i.source_platform, i.full_name, i.email, i.country, i.locale, i.status,
            i.invite_expires_at, i.registered_user_id, g.name AS source_name
       FROM platform_transfers_inbound i LEFT JOIN group_platforms g ON g.slug = i.source_platform
      WHERE i.invite_token_hash = $1`,
    [hashInviteToken(token)],
  );
  const row = r.rows[0];
  if (!row) return { ok: false, reason: 'invalid' };
  if (row.status === 'revoked') return { ok: false, reason: 'revoked' };
  if (row.registered_user_id) return { ok: false, reason: 'used' };
  if (row.status === 'expired' || new Date(iso(row.invite_expires_at)!) <= now) return { ok: false, reason: 'expired' };
  const parts = String(row.full_name).trim().split(/\s+/);
  return {
    ok: true,
    prefill: {
      transferId: String(row.transfer_id),
      number: String(row.number),
      sourcePlatform: String(row.source_platform),
      sourceName: String(row.source_name ?? row.source_platform),
      firstName: parts[0] ?? '',
      lastName: parts.slice(1).join(' '),
      email: String(row.email),
      country: (row.country as string | null) ?? null,
      locale: row.locale === 'en' ? 'en' : 'ru',
    },
  };
}

/**
 * Связать нового клиента с приглашением — В ТОЙ ЖЕ транзакции, что и создание
 * пользователя. Токен одноразовый (условие в WHERE). Источнику уходит статус
 * `registered`. Неверный/использованный токен регистрацию не ломает —
 * клиент просто регистрируется без связи (возвращается `false`).
 */
export async function bindInviteWithinTx(
  tx: Queryable,
  input: { token: string; userId: string; now?: Date },
): Promise<boolean> {
  const now = input.now ?? new Date();
  const r = await tx.query(
    `UPDATE platform_transfers_inbound
        SET status = 'registered', registered_user_id = $2, registered_at = $3, invite_token_hash = NULL, updated_at = $3,
            invited_at = COALESCE(invited_at, $3)
      WHERE invite_token_hash = $1 AND status IN ('received', 'invited') AND registered_user_id IS NULL AND invite_expires_at > $3
      RETURNING transfer_id, number, source_platform`,
    [hashInviteToken(input.token), input.userId, now],
  );
  const row = r.rows[0];
  if (!row) return false;
  const transferId = String(row.transfer_id);
  const seq = await journal(tx, {
    operatorId: TRANSFER_SYSTEM_OPERATOR,
    action: TRANSFER_ACTIONS.registered,
    subjectKind: 'client',
    subjectId: input.userId,
    payload: { transferId, number: String(row.number), source: String(row.source_platform) },
  });
  await tx.query(`UPDATE platform_transfers_inbound SET last_journal_seq = $2 WHERE transfer_id = $1`, [transferId, seq]);
  const data: StatusData = { number: String(row.number), event: 'registered', at: now.toISOString() };
  await enqueueMessage(tx, { transferId, to: String(row.source_platform), kind: 'transfer.status', data, event: 'registered' });
  return true;
}

/* ── Наблюдения воркера цели ──────────────────────────────────────────── */

async function emitInboundEvent(
  pool: PoolLike,
  sql: string,
  params: unknown[],
  event: 'invited' | 'kyc_passed' | 'expired',
  action: string,
): Promise<number> {
  return inTransaction(pool, async (tx) => {
    const r = await tx.query(sql, params);
    for (const row of r.rows) {
      const transferId = String(row.transfer_id);
      const at = iso(row.at) ?? new Date().toISOString();
      await journal(tx, {
        operatorId: TRANSFER_SYSTEM_OPERATOR,
        action,
        subjectKind: row.registered_user_id ? 'client' : 'platform_transfer',
        subjectId: row.registered_user_id ? String(row.registered_user_id) : transferId,
        payload: { transferId, number: String(row.number), source: String(row.source_platform) },
      });
      const data: StatusData = { number: String(row.number), event, at };
      await enqueueMessage(tx, { transferId, to: String(row.source_platform), kind: 'transfer.status', data, event });
    }
    return r.rows.length;
  });
}

/** Письмо-приглашение ушло (воркер почты отметил `sent`) → `invited`. */
export function detectInvitesSent(pool: PoolLike): Promise<number> {
  return emitInboundEvent(
    pool,
    `UPDATE platform_transfers_inbound i SET status = 'invited', invited_at = m.sent_at, updated_at = now()
       FROM outbound_mail m
      WHERE m.id = i.invite_mail_id AND m.status = 'sent' AND i.status = 'received'
      RETURNING i.transfer_id, i.number, i.source_platform, i.registered_user_id, m.sent_at AS at`,
    [],
    'invited',
    TRANSFER_ACTIONS.invited,
  );
}

/** Клиент цели прошёл KYC (решение KYC цели) → `kyc_passed`. */
export function detectKycPassed(pool: PoolLike): Promise<number> {
  return emitInboundEvent(
    pool,
    `UPDATE platform_transfers_inbound i SET status = 'kyc_passed', kyc_passed_at = v.updated_at, updated_at = now()
       FROM client_verification v
      WHERE v.user_id = i.registered_user_id AND v.state = 'verified' AND i.status = 'registered'
      RETURNING i.transfer_id, i.number, i.source_platform, i.registered_user_id, v.updated_at AS at`,
    [],
    'kyc_passed',
    TRANSFER_ACTIONS.kycPassed,
  );
}

/** Срок приглашения истёк без регистрации → `expired`. */
export function expireInvites(pool: PoolLike, now = new Date()): Promise<number> {
  return emitInboundEvent(
    pool,
    `UPDATE platform_transfers_inbound SET status = 'expired', invite_token_hash = NULL, updated_at = $1
      WHERE status IN ('received', 'invited') AND invite_expires_at <= $1
      RETURNING transfer_id, number, source_platform, registered_user_id, $1::timestamptz AS at`,
    [now],
    'expired',
    TRANSFER_ACTIONS.expired,
  );
}

/** Возврат после регистрации: заморозить торговлю в терминале (повтор до успеха). */
export async function applyPendingFreezes(pool: PoolLike, terminal: TransferTerminalPort): Promise<number> {
  const r = await pool.query(
    `SELECT transfer_id, number, registered_user_id FROM platform_transfers_inbound
      WHERE freeze_state = 'pending' AND registered_user_id IS NOT NULL ORDER BY revoked_at LIMIT 20`,
  );
  let done = 0;
  for (const row of r.rows) {
    const out = await terminal.setTradingFrozen(String(row.registered_user_id), true, `Перевод ${row.number} отозван группой`);
    if (out !== 'ok') continue;
    await pool.query(`UPDATE platform_transfers_inbound SET freeze_state = 'applied', updated_at = now() WHERE transfer_id = $1`, [
      row.transfer_id,
    ]);
    done++;
  }
  return done;
}

/** Менеджер цели вернул средства клиенту (обычным выводом) — задача закрыта. */
export async function completeRefundTask(
  pool: PoolLike,
  input: { operatorId: string; transferId: string; note: string },
): Promise<{ ok: boolean; reason?: 'missingReason' | 'notOpen' }> {
  const note = input.note.trim();
  if (!note) return { ok: false, reason: 'missingReason' };
  return inTransaction(pool, async (tx) => {
    const r = await tx.query(
      `UPDATE platform_transfers_inbound SET refund_task = 'done', refund_task_done_by = $2, refund_task_done_at = now(),
              refund_task_note = $3, updated_at = now()
        WHERE transfer_id = $1 AND refund_task = 'open' RETURNING number, registered_user_id`,
      [input.transferId, input.operatorId, note],
    );
    const row = r.rows[0];
    if (!row) return { ok: false, reason: 'notOpen' as const };
    await journal(tx, {
      operatorId: input.operatorId,
      action: TRANSFER_ACTIONS.refundTaskDone,
      subjectKind: 'client',
      subjectId: String(row.registered_user_id),
      payload: { basis: note, transferId: input.transferId, number: String(row.number) },
    });
    return { ok: true };
  });
}
