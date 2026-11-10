import { createHash, randomBytes } from 'node:crypto';
import { appendJournalWithinTx, inTransaction, rollback, SYSTEM_OPERATORS, type PoolLike, type Queryable } from '@broker/money';
import { SUPPORT_ACTIONS } from './model';
import { enqueueMail } from './outbound';
import type { SupportSettings } from './settings';
import { firstNameOf, isPlausibleEmail, normalizeEmail, renderTemplate } from './text';

/**
 * Auth-письма через почту поддержки (решение владельца 10.11): сброс пароля
 * и подтверждение email.
 *
 * Свойства, которые проверяются тестами:
 *  - токен — 32 случайных байта, в базе только sha256;
 *  - одноразовый (`used_at`), со сроком жизни;
 *  - запрос сброса НЕ раскрывает, существует ли email: ответ один и тот же,
 *    письмо уходит только существующему, строка для лимита пишется всегда;
 *  - лимит частоты — по email и по IP, считается по базе;
 *  - успешный сброс гасит все сессии клиента (украденная сессия не живёт
 *    дольше смены пароля) и другие живые токены сброса.
 */

export const RESET_TTL_MINUTES = 30;
export const VERIFY_TTL_HOURS = 24;
export const LIMIT_PER_EMAIL_PER_HOUR = 3;
export const LIMIT_PER_IP_PER_HOUR = 10;

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
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
  (path: string, token: string, locale: 'ru' | 'en'): string;
}

/** Ответ запроса сброса — ВСЕГДА один и тот же (не оракул существования email). */
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
    const token = newToken();
    const locale = user.locale === 'en' ? 'en' : 'ru';
    await tx.query(
      `INSERT INTO auth_mail_tokens (purpose, user_id, email, token_hash, request_ip, expires_at, created_at)
       VALUES ('password_reset', $1, $2, $3, $4, $5, $6)`,
      [user.id, email, hashToken(token), input.ip, expiresAt, now],
    );
    const t = settings.texts[locale];
    const vars = {
      client: { firstName: firstNameOf(String(user.full_name)) },
      link: input.link('/reset-password', token, locale),
      ttlMinutes: RESET_TTL_MINUTES,
    };
    await enqueueMail(tx, {
      purpose: 'password_reset',
      to: email,
      subject: renderTemplate(t.passwordResetSubject, vars),
      bodyText: renderTemplate(t.passwordResetBody, vars),
      expiresAt,
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

/** Проверка токена без расхода (страница «новый пароль» до отправки формы). */
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

/**
 * Новый пароль по токену. Хеш пароля считает вызывающий (у кабинета свой
 * алгоритм), пакет его не знает. Токен расходуется атомарно: два параллельных
 * запроса с одним токеном — успех только у одного.
 */
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
    // Другие живые ссылки сброса — недействительны; все сессии — погашены.
    await tx.query(
      `UPDATE auth_mail_tokens SET used_at = $2 WHERE user_id = $1 AND purpose = 'password_reset' AND used_at IS NULL`,
      [userId, now],
    );
    await tx.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
    // Ссылка пришла на почту — значит, почта подтверждена.
    await tx.query(`UPDATE users SET email_verified_at = COALESCE(email_verified_at, $2) WHERE id = $1`, [userId, now]);
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
    const token = newToken();
    const locale = user.locale === 'en' ? 'en' : 'ru';
    const expiresAt = new Date(now.getTime() + VERIFY_TTL_HOURS * 3_600_000);
    await tx.query(
      `INSERT INTO auth_mail_tokens (purpose, user_id, email, token_hash, request_ip, expires_at, created_at)
       VALUES ('email_verify', $1, $2, $3, $4, $5, $6)`,
      [user.id, email, hashToken(token), input.ip, expiresAt, now],
    );
    const t = settings.texts[locale];
    const vars = {
      client: { firstName: firstNameOf(String(user.full_name)) },
      link: input.link('/verify-email', token, locale),
      ttlHours: VERIFY_TTL_HOURS,
    };
    await enqueueMail(tx, {
      purpose: 'email_verify',
      to: email,
      subject: renderTemplate(t.emailVerifySubject, vars),
      bodyText: renderTemplate(t.emailVerifyBody, vars),
      expiresAt,
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

/**
 * Подтверждение email по ссылке. Токен привязан к адресу, на который ушёл:
 * если клиент сменил email после отправки — ссылка уже не подтверждает новый.
 */
export async function confirmEmail(
  db: PoolLike,
  input: { token: string; now?: Date },
): Promise<ConsumeResult> {
  const now = input.now ?? new Date();
  return inTransaction<ConsumeResult>(db, async (tx) => {
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
      return rollback({ ok: false as const, reason: why.ok ? ('invalidToken' as const) : why.reason });
    }
    await tx.query(`UPDATE users SET email_verified_at = COALESCE(email_verified_at, $2) WHERE id = $1`, [userId, now]);
    await appendJournalWithinTx(
      {
        operatorId: SYSTEM_OPERATORS.cabinet,
        action: SUPPORT_ACTIONS.emailVerified,
        subjectKind: 'client',
        subjectId: userId,
        payload: {},
      },
      tx,
    );
    return { ok: true as const, userId };
  });
}
