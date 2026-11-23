import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { isPlatformLocale, type PlatformLocale } from '@broker/utils/locales';
import { getPool } from '../db';
import { SESSION_HINT_COOKIE, SESSION_HINT_VALUE, sessionHintDomain } from '@broker/utils/session-hint';
import { SESSION_COOKIE, SESSION_TTL_DAYS } from './constants';

export interface SessionUser {
  id: string;
  uid: number | null;
  email: string;
  fullName: string;
  locale: PlatformLocale;
  vipLevel: number;
  createdAt: Date;
  mustChangePassword: boolean;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 3600 * 1000);
  const requestHeaders = headers();
  await getPool().query(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      randomUUID(),
      userId,
      hashToken(token),
      expiresAt.toISOString(),
      requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      requestHeaders.get('user-agent')?.slice(0, 300) ?? null,
    ],
  );
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_DAYS * 24 * 3600,
  });
  setSessionHint();
  return token;
}

/**
 * Флажок для витрины «клиент вошёл» на общем домене. Без секретов (значение всегда `1`),
 * не httpOnly — витрина читает его в браузере. См. @broker/utils/session-hint.
 */
export function setSessionHint(): void {
  const domain = sessionHintDomain();
  cookies().set(SESSION_HINT_COOKIE, SESSION_HINT_VALUE, {
    httpOnly: false,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_DAYS * 24 * 3600,
    ...(domain ? { domain } : {}),
  });
}

export function clearSessionHint(): void {
  const domain = sessionHintDomain();
  cookies().set(SESSION_HINT_COOKIE, '', { path: '/', maxAge: 0, ...(domain ? { domain } : {}) });
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const result = await getPool().query(
    `SELECT u.id, u.uid, u.email, u.full_name, u.locale, u.vip_level, u.created_at, u.password_must_change,
            COALESCE(cb.blocked, false) AS blocked
       FROM sessions s JOIN users u ON u.id = s.user_id
       LEFT JOIN client_blocks cb ON cb.user_id = u.id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  const row = result.rows[0];
  if (!row) return null;
  if (row.blocked === true) return null;
  if (row.uid === null || row.uid === undefined) {
    console.error(
      `[auth] у пользователя ${row.id} нет uid, хотя колонка NOT NULL: ` +
        'показываем прочерк, номер не выдумываем (QA-05)',
    );
  }

  return {
    id: row.id,
    uid: row.uid === null || row.uid === undefined ? null : Number(row.uid),
    email: row.email,
    fullName: row.full_name,
    locale: isPlatformLocale(row.locale) ? row.locale : 'ru',
    vipLevel: Number(row.vip_level),
    createdAt: row.created_at,
    mustChangePassword: row.password_must_change === true,
  };
}

export async function destroyCurrentSession(): Promise<void> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (token) {
    await getPool().query(`DELETE FROM sessions WHERE token_hash = $1`, [hashToken(token)]);
  }
  cookies().delete(SESSION_COOKIE);
  clearSessionHint();
}

export interface SessionInfo {
  id: string;
  createdAt: Date;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
}

export async function listSessions(userId: string): Promise<SessionInfo[]> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const currentHash = token ? hashToken(token) : '';
  const result = await getPool().query(
    `SELECT id, token_hash, created_at, ip, user_agent
       FROM sessions WHERE user_id = $1 AND expires_at > now()
      ORDER BY created_at DESC`,
    [userId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    ip: row.ip,
    userAgent: row.user_agent,
    current: row.token_hash === currentHash,
  }));
}

export async function revokeSession(userId: string, sessionId: string): Promise<void> {
  await getPool().query(`DELETE FROM sessions WHERE id = $1 AND user_id = $2`, [
    sessionId,
    userId,
  ]);
}
