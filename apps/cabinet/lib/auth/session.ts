import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { getPool } from '../db';
import { SESSION_COOKIE, SESSION_TTL_DAYS } from './constants';

/**
 * Сессии (ADR-022): в куке — opaque-токен, в БД — его sha256.
 * Ревокация из UI работает мгновенно; дамп БД не даёт живых сессий;
 * JWT сознательно не используется — нечего инвалидировать.
 */

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  locale: 'ru' | 'en';
  createdAt: Date;
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
  return token;
}

/** Пользователь текущего запроса или null (протухшие сессии игнорируются). */
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const result = await getPool().query(
    `SELECT u.id, u.email, u.full_name, u.locale, u.created_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    locale: row.locale === 'en' ? 'en' : 'ru',
    createdAt: row.created_at,
  };
}

export async function destroyCurrentSession(): Promise<void> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (token) {
    await getPool().query(`DELETE FROM sessions WHERE token_hash = $1`, [hashToken(token)]);
  }
  cookies().delete(SESSION_COOKIE);
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

/** Ревокация чужой сессии пользователя (только своей учётки). */
export async function revokeSession(userId: string, sessionId: string): Promise<void> {
  await getPool().query(`DELETE FROM sessions WHERE id = $1 AND user_id = $2`, [
    sessionId,
    userId,
  ]);
}
