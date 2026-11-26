import { createHash, randomBytes } from 'node:crypto';
import { appendJournalWithinTx, inTransaction, rollback, SYSTEM_OPERATORS, type PoolLike, type Queryable } from '@broker/money';
import { SUPPORT_ACTIONS } from './model';
import { enqueueMail } from './outbound';
import type { SupportSettings } from './settings';
import { firstNameOf, isPlausibleEmail, mailLocale, normalizeEmail, renderTemplate } from './text';

export const RESET_TTL_MINUTES = 30;
export const VERIFY_TTL_HOURS = 24;
export const LIMIT_PER_EMAIL_PER_HOUR = 3;
export const LIMIT_PER_IP_PER_HOUR = 10;
/** Повторная ссылка подтверждения — не чаще раза в минуту на адрес. */
export const RESEND_MIN_INTERVAL_SECONDS = 60;
/** Неактивированные регистрации (почта так и не подтверждена) удаляются через столько дней. */
export const UNACTIVATED_TTL_DAYS = 7;

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function authMailLimited(tx: Queryable, purpose: string, email: string, ip: string | null, now: Date): Promise<boolean> {
  return limited(tx, purpose, email, ip, now);
}

async function limited(tx: Queryable, purpose: string, email: string, ip: string | null, now: Date): Promise<boolean> {
  const since = new Date(now.getTime() - 3_600_000);
  const byEmail = await tx.query(
    `SELECT count(*)::int AS n FROM auth_mail_tokens WHERE purpose = $1 AND lower(email) = $2 AND created_at > $3`,
    [purpose, email, since],
  );
  if (Number(byEmail.rows[0]?.n ?? 0) >= LIMIT_PER_EMAIL_PER_HOUR) return true;
  if (ip) {
    const byIp = await tx.query(
      `SELECT count(*)::int AS n FROM auth_mail_tokens WHERE purpose = $1 AND request_ip = $2 AND created_at > $3`,
      [purpose, ip, since],
    );
    if (Number(byIp.rows[0]?.n ?? 0) >= LIMIT_PER_IP_PER_HOUR) return true;
  }
  return false;
}

export interface LinkBuilder {
  (path: string, token: string, locale: string): string;
}

export interface AuthMailUser {
  id: string;
  email: string;
  fullName: string;
  locale: string;
}

export async function issuePasswordResetMail(
  tx: Queryable,
  settings: SupportSettings,
  input: { user: AuthMailUser; link: LinkBuilder; ip: string | null; now: Date },
): Promise<{ expiresAt: Date }> {
  const { user, now } = input;
  const email = normalizeEmail(user.email);
  const token = newToken();
  const locale = mailLocale(user.locale);
  const expiresAt = new Date(now.getTime() + RESET_TTL_MINUTES * 60_000);
  await tx.query(
    `INSERT INTO auth_mail_tokens (purpose, user_id, email, token_hash, request_ip, expires_at, created_at)
     VALUES ('password_reset', $1, $2, $3, $4, $5, $6)`,
    [user.id, email, hashToken(token), input.ip, expiresAt, now],
  );
  const t = settings.texts[locale];
  const vars = {
    client: { firstName: firstNameOf(user.fullName) },
    link: input.link('/reset-password', token, user.locale),
    ttlMinutes: RESET_TTL_MINUTES,
  };
  await enqueueMail(tx, {
    purpose: 'password_reset',
    to: email,
    subject: renderTemplate(t.passwordResetSubject, vars),
    bodyText: renderTemplate(t.passwordResetBody, vars),
    expiresAt,
  });
  return { expiresAt };
}

export async function issueEmailVerifyMail(
  tx: Queryable,
  settings: SupportSettings,
  input: { user: AuthMailUser; link: LinkBuilder; ip: string | null; now: Date },
): Promise<{ expiresAt: Date }> {
  const { user, now } = input;
  const email = normalizeEmail(user.email);
  const token = newToken();
  const locale = mailLocale(user.locale);
  const expiresAt = new Date(now.getTime() + VERIFY_TTL_HOURS * 3_600_000);
  await tx.query(
    `INSERT INTO auth_mail_tokens (purpose, user_id, email, token_hash, request_ip, expires_at, created_at)
     VALUES ('email_verify', $1, $2, $3, $4, $5, $6)`,
    [user.id, email, hashToken(token), input.ip, expiresAt, now],
  );
  const t = settings.texts[locale];
  const vars = {
    client: { firstName: firstNameOf(user.fullName) },
    link: input.link('/verify-email', token, user.locale),
    ttlHours: VERIFY_TTL_HOURS,
  };
  await enqueueMail(tx, {
    purpose: 'email_verify',
    to: email,
    subject: renderTemplate(t.emailVerifySubject, vars),
    bodyText: renderTemplate(t.emailVerifyBody, vars),
    expiresAt,
  });
  return { expiresAt };
}

export type ResetRequestResult = { ok: true; internal: 'sent' | 'unknownEmail' | 'rateLimited' | 'invalid' };

export async function requestPasswordReset(
  db: PoolLike,
  settings: SupportSettings,
  input: { email: string; ip: string | null; link: LinkBuilder; now?: Date },
): Promise<ResetRequestResult> {
  const email = normalizeEmail(input.email);
  if (!isPlausibleEmail(email)) return { ok: true, internal: 'invalid' };
  const now = input.now ?? new Date();
  return inTransaction<ResetRequestResult>(db, async (tx) => {
    if (await limited(tx, 'password_reset', email, input.ip, now)) return { ok: true as const, internal: 'rateLimited' as const };
    const u = await tx.query(`SELECT id, full_name, locale FROM users WHERE lower(email) = $1`, [email]);
    const user = u.rows[0];
    const expiresAt = new Date(now.getTime() + RESET_TTL_MINUTES * 60_000);
    if (!user) {
      await tx.query(
        `INSERT INTO auth_mail_tokens (purpose, email, request_ip, expires_at, created_at) VALUES ('password_reset', $1, $2, $3, $4)`,
        [email, input.ip, expiresAt, now],
      );
      return { ok: true as const, internal: 'unknownEmail' as const };
    }
    await issuePasswordResetMail(tx, settings, {
      user: { id: String(user.id), email, fullName: String(user.full_name), locale: String(user.locale) },
      link: input.link,
      ip: input.ip,
      now,
    });
    await appendJournalWithinTx(
      {
        operatorId: SYSTEM_OPERATORS.cabinet,
        action: SUPPORT_ACTIONS.passwordResetRequested,
        subjectKind: 'client',
        subjectId: String(user.id),
        payload: { ip: input.ip },
      },
      tx,
    );
    return { ok: true as const, internal: 'sent' as const };
  });
}

export type ConsumeFailure = 'invalidToken' | 'expiredToken' | 'usedToken';
export type ConsumeResult = { ok: true; userId: string } | { ok: false; reason: ConsumeFailure };

export async function inspectToken(
  db: Queryable,
  purpose: 'password_reset' | 'email_verify',
  token: string,
  now = new Date(),
): Promise<{ ok: true; userId: string } | { ok: false; reason: ConsumeFailure }> {
  if (!token || token.length > 200) return { ok: false, reason: 'invalidToken' };
  const r = await db.query(
    `SELECT user_id, expires_at, used_at FROM auth_mail_tokens WHERE token_hash = $1 AND purpose = $2`,
    [hashToken(token), purpose],
  );
  const row = r.rows[0];
  if (!row) return { ok: false, reason: 'invalidToken' };
  if (row.used_at) return { ok: false, reason: 'usedToken' };
  if (new Date(row.expires_at as string) <= now) return { ok: false, reason: 'expiredToken' };
  return { ok: true, userId: String(row.user_id) };
}

export async function completePasswordReset(
  db: PoolLike,
  input: { token: string; passwordHash: string; now?: Date },
): Promise<ConsumeResult> {
  const now = input.now ?? new Date();
  return inTransaction<ConsumeResult>(db, async (tx) => {
    const r = await tx.query(
      `UPDATE auth_mail_tokens SET used_at = $2
        WHERE token_hash = $1 AND purpose = 'password_reset' AND used_at IS NULL AND expires_at > $2
        RETURNING user_id`,
      [hashToken(input.token), now],
    );
    const userId = r.rows[0]?.user_id as string | undefined;
    if (!userId) {
      const why = await inspectToken(tx, 'password_reset', input.token, now);
      return rollback({ ok: false as const, reason: why.ok ? ('invalidToken' as const) : why.reason });
    }
    await tx.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [userId, input.passwordHash]);
    await tx.query(
      `UPDATE auth_mail_tokens SET used_at = $2 WHERE user_id = $1 AND purpose = 'password_reset' AND used_at IS NULL`,
      [userId, now],
    );
    await tx.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
    await tx.query(
      `UPDATE users SET email_verified_at = COALESCE(email_verified_at, $2), activated_at = COALESCE(activated_at, $2) WHERE id = $1`,
      [userId, now],
    );
    await appendJournalWithinTx(
      {
        operatorId: SYSTEM_OPERATORS.cabinet,
        action: SUPPORT_ACTIONS.passwordResetCompleted,
        subjectKind: 'client',
        subjectId: userId,
        payload: { sessionsRevoked: true },
      },
      tx,
    );
    return { ok: true as const, userId };
  });
}

export type VerifyRequestResult = 'sent' | 'alreadyVerified' | 'rateLimited' | 'invalidClient';

export async function requestEmailVerification(
  db: PoolLike,
  settings: SupportSettings,
  input: { userId: string; ip: string | null; link: LinkBuilder; now?: Date },
): Promise<VerifyRequestResult> {
  const now = input.now ?? new Date();
  return inTransaction<VerifyRequestResult>(db, async (tx) => {
    const u = await tx.query(`SELECT id, email, full_name, locale, email_verified_at FROM users WHERE id = $1`, [input.userId]);
    const user = u.rows[0];
    if (!user) return 'invalidClient' as const;
    if (user.email_verified_at) return 'alreadyVerified' as const;
    const email = normalizeEmail(String(user.email));
    if (await limited(tx, 'email_verify', email, input.ip, now)) return 'rateLimited' as const;
    await issueEmailVerifyMail(tx, settings, {
      user: { id: String(user.id), email, fullName: String(user.full_name), locale: String(user.locale) },
      link: input.link,
      ip: input.ip,
      now,
    });
    await appendJournalWithinTx(
      {
        operatorId: SYSTEM_OPERATORS.cabinet,
        action: SUPPORT_ACTIONS.emailVerifySent,
        subjectKind: 'client',
        subjectId: String(user.id),
        payload: {},
      },
      tx,
    );
    return 'sent' as const;
  });
}

export type ConfirmEmailResult =
  | { ok: true; userId: string; activatedNow: boolean; twoFactor: boolean }
  | { ok: false; reason: ConsumeFailure };

/**
 * Подтверждение адреса по ссылке. Первое подтверждение активирует учётную запись
 * (`activated_at`): только после него кабинет выдаёт сессию. Остальные ещё не
 * использованные ссылки подтверждения этого клиента гасятся.
 */
export async function confirmEmail(
  db: PoolLike,
  input: { token: string; now?: Date },
): Promise<ConfirmEmailResult> {
  const now = input.now ?? new Date();
  return inTransaction<ConfirmEmailResult>(db, async (tx) => {
    const r = await tx.query(
      `UPDATE auth_mail_tokens a SET used_at = $2
         FROM users u
        WHERE a.token_hash = $1 AND a.purpose = 'email_verify' AND a.used_at IS NULL AND a.expires_at > $2
          AND u.id = a.user_id AND lower(u.email) = lower(a.email)
        RETURNING a.user_id`,
      [hashToken(input.token), now],
    );
    const userId = r.rows[0]?.user_id as string | undefined;
    if (!userId) {
      const why = await inspectToken(tx, 'email_verify', input.token, now);
      return rollback<ConfirmEmailResult>({ ok: false as const, reason: why.ok ? ('invalidToken' as const) : why.reason });
    }
    const before = await tx.query(`SELECT activated_at FROM users WHERE id = $1 FOR UPDATE`, [userId]);
    const activatedNow = before.rows[0]?.activated_at === null || before.rows[0]?.activated_at === undefined;
    await tx.query(
      `UPDATE users SET email_verified_at = COALESCE(email_verified_at, $2), activated_at = COALESCE(activated_at, $2)
        WHERE id = $1`,
      [userId, now],
    );
    await tx.query(
      `UPDATE auth_mail_tokens SET used_at = $2 WHERE user_id = $1 AND purpose = 'email_verify' AND used_at IS NULL`,
      [userId, now],
    );
    const tf = await tx.query(`SELECT 1 FROM client_totp WHERE user_id = $1 AND enabled_at IS NOT NULL`, [userId]);
    await appendJournalWithinTx(
      {
        operatorId: SYSTEM_OPERATORS.cabinet,
        action: SUPPORT_ACTIONS.emailVerified,
        subjectKind: 'client',
        subjectId: userId,
        payload: activatedNow ? { activated: true } : {},
      },
      tx,
    );
    return { ok: true as const, userId, activatedNow, twoFactor: tf.rows.length > 0 };
  });
}

export type ActivationLinkResult = {
  ok: true;
  internal: 'sent' | 'unknownEmail' | 'alreadyVerified' | 'tooSoon' | 'rateLimited' | 'invalid';
};

/**
 * Повторная ссылка подтверждения по адресу: экран «проверьте почту», вход с
 * неподтверждённой почтой, повторная регистрация того же адреса. Наружу ответ всегда
 * одинаковый; `internal` — только для логов и тестов, по нему не узнать, есть ли адрес.
 * Попытка на неизвестный или уже подтверждённый адрес тоже записывается (без токена),
 * чтобы интервал и часовой лимит считались одинаково для любого адреса.
 */
export async function requestActivationLink(
  db: PoolLike,
  settings: SupportSettings,
  input: { email: string; ip: string | null; link: LinkBuilder; now?: Date },
): Promise<ActivationLinkResult> {
  const email = normalizeEmail(input.email);
  if (!isPlausibleEmail(email)) return { ok: true, internal: 'invalid' };
  const now = input.now ?? new Date();
  return inTransaction<ActivationLinkResult>(db, async (tx) => {
    const recent = await tx.query(
      `SELECT 1 FROM auth_mail_tokens WHERE purpose = 'email_verify' AND lower(email) = $1 AND created_at > $2 LIMIT 1`,
      [email, new Date(now.getTime() - RESEND_MIN_INTERVAL_SECONDS * 1000)],
    );
    if (recent.rows.length > 0) return { ok: true as const, internal: 'tooSoon' as const };
    if (await limited(tx, 'email_verify', email, input.ip, now)) return { ok: true as const, internal: 'rateLimited' as const };
    const u = await tx.query(
      `SELECT id, email, full_name, locale, email_verified_at FROM users WHERE lower(email) = $1 FOR UPDATE`,
      [email],
    );
    const user = u.rows[0];
    if (!user || user.email_verified_at) {
      await tx.query(
        `INSERT INTO auth_mail_tokens (purpose, email, request_ip, expires_at, created_at) VALUES ('email_verify', $1, $2, $3, $4)`,
        [email, input.ip, new Date(now.getTime() + VERIFY_TTL_HOURS * 3_600_000), now],
      );
      return { ok: true as const, internal: user ? ('alreadyVerified' as const) : ('unknownEmail' as const) };
    }
    await issueEmailVerifyMail(tx, settings, {
      user: { id: String(user.id), email, fullName: String(user.full_name), locale: String(user.locale) },
      link: input.link,
      ip: input.ip,
      now,
    });
    await appendJournalWithinTx(
      {
        operatorId: SYSTEM_OPERATORS.cabinet,
        action: SUPPORT_ACTIONS.emailVerifySent,
        subjectKind: 'client',
        subjectId: String(user.id),
        payload: { resend: true },
      },
      tx,
    );
    return { ok: true as const, internal: 'sent' as const };
  });
}

/**
 * Таблицы, строки в которых защищают неактивированного пользователя от удаления: деньги,
 * документы, обращения. У того, кто ни разу не вошёл, их быть не должно; если есть —
 * повод разобраться, а не молча стереть.
 */
export const PURGE_PROTECTED: readonly string[] = [
  'real_accounts',
  'demo_accounts',
  'crypto_deposits',
  'crypto_withdrawals',
  'money_commands',
  'platform_transfers',
  'platform_transfers_inbound',
  'kyc_documents',
  'documents',
  'support_tickets',
  'promo_rewards',
];

export interface PurgeResult {
  deleted: number;
  skipped: { userId: string; reason: string }[];
}

function quoteIdent(name: string): string {
  return name
    .split('.')
    .map((part) => `"${part.replace(/^"|"$/g, '').replace(/"/g, '""')}"`)
    .join('.');
}

/**
 * Удаляет регистрации, которые не подтвердили почту за `UNACTIVATED_TTL_DAYS` и ни разу
 * не входили. Связанные служебные строки (уведомления, согласия, атрибуция, токены)
 * уходят по внешним ключам: каскадные — сами, остальные — явно (обязательная ссылка —
 * удаление строки, необязательная — обнуление). Каждый пользователь — в своей точке
 * сохранения: одна ошибка не мешает остальным.
 */
export async function purgeUnactivatedUsers(
  db: PoolLike,
  input: { now?: Date; olderThanDays?: number; limit?: number } = {},
): Promise<PurgeResult> {
  const now = input.now ?? new Date();
  const days = input.olderThanDays ?? UNACTIVATED_TTL_DAYS;
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  return inTransaction<PurgeResult>(db, async (tx) => {
    const fks = await tx.query(
      `SELECT c.conrelid::regclass::text AS tbl, a.attname AS col, a.attnotnull AS notnull
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'f' AND c.confrelid = 'users'::regclass AND c.confdeltype <> 'c'
        ORDER BY 1, 2`,
    );
    const candidates = await tx.query(
      `SELECT id FROM users
        WHERE activated_at IS NULL AND last_login_at IS NULL AND created_at < $1
        ORDER BY created_at LIMIT $2`,
      [cutoff, input.limit ?? 200],
    );
    const result: PurgeResult = { deleted: 0, skipped: [] };
    for (const c of candidates.rows) {
      const userId = String(c.id);
      const used = new Set<string>();
      for (const fk of fks.rows) {
        const tbl = String(fk.tbl);
        if (!PURGE_PROTECTED.includes(tbl)) continue;
        const hit = await tx.query(`SELECT 1 FROM ${quoteIdent(tbl)} WHERE ${quoteIdent(String(fk.col))} = $1 LIMIT 1`, [userId]);
        if (hit.rows.length > 0) used.add(tbl);
      }
      if (used.size > 0) {
        result.skipped.push({ userId, reason: `есть строки: ${[...used].join(', ')}` });
        continue;
      }
      await tx.query('SAVEPOINT purge_user');
      try {
        for (const fk of fks.rows) {
          const tbl = quoteIdent(String(fk.tbl));
          const col = quoteIdent(String(fk.col));
          if (fk.notnull === true) await tx.query(`DELETE FROM ${tbl} WHERE ${col} = $1`, [userId]);
          else await tx.query(`UPDATE ${tbl} SET ${col} = NULL WHERE ${col} = $1`, [userId]);
        }
        await tx.query(`DELETE FROM users WHERE id = $1 AND activated_at IS NULL`, [userId]);
        await tx.query('RELEASE SAVEPOINT purge_user');
        result.deleted += 1;
      } catch (error) {
        await tx.query('ROLLBACK TO SAVEPOINT purge_user');
        result.skipped.push({ userId, reason: (error as Error).message.slice(0, 200) });
      }
    }
    if (result.deleted > 0) {
      await appendJournalWithinTx(
        {
          operatorId: SYSTEM_OPERATORS.support,
          action: SUPPORT_ACTIONS.unactivatedPurged,
          subjectKind: 'platform',
          subjectId: 'unactivated-registrations',
          payload: { deleted: result.deleted, olderThanDays: days },
        },
        tx,
      );
    }
    return result;
  });
}

export type ForcedChangeResult = { ok: true; sessionsRevoked: number } | { ok: false; reason: 'notRequired' };

export async function completeForcedPasswordChange(
  db: PoolLike,
  input: { userId: string; passwordHash: string; keepSessionTokenHash: string | null; now?: Date },
): Promise<ForcedChangeResult> {
  const now = input.now ?? new Date();
  return inTransaction<ForcedChangeResult>(db, async (tx) => {
    const r = await tx.query(
      `UPDATE users SET password_hash = $2, password_must_change = false, temp_password_expires_at = NULL
        WHERE id = $1 AND password_must_change RETURNING id`,
      [input.userId, input.passwordHash],
    );
    if (r.rows.length === 0) return rollback<ForcedChangeResult>({ ok: false, reason: 'notRequired' });
    const s = await tx.query(
      `DELETE FROM sessions WHERE user_id = $1 AND token_hash IS DISTINCT FROM $2 RETURNING id`,
      [input.userId, input.keepSessionTokenHash],
    );
    await tx.query(
      `UPDATE auth_mail_tokens SET used_at = $2 WHERE user_id = $1 AND purpose = 'password_reset' AND used_at IS NULL`,
      [input.userId, now],
    );
    await appendJournalWithinTx(
      {
        operatorId: SYSTEM_OPERATORS.cabinet,
        action: 'client.credentials.temp_password_replaced',
        subjectKind: 'client',
        subjectId: input.userId,
        payload: { otherSessionsRevoked: s.rows.length },
      },
      tx,
    );
    return { ok: true as const, sessionsRevoked: s.rows.length };
  });
}
