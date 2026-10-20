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
  /**
   * Публичный номер пользователя (показывается в ЛК, ADR-026).
   *
   * `null` — номера нет. Это аномалия строки, а не состояние: колонка
   * `NOT NULL`, последовательность начинается со 100001. Но подставить
   * вместо него ноль нельзя: «UID 0» выглядит как настоящий номер, и
   * человек процитирует его поддержке как факт — отправив и себя, и
   * поддержку искать несуществующий счёт.
   */
  uid: number | null;
  email: string;
  fullName: string;
  locale: 'ru' | 'en';
  vipLevel: number;
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
    `SELECT u.id, u.uid, u.email, u.full_name, u.locale, u.vip_level, u.created_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  const row = result.rows[0];
  if (!row) return null;
  /*
   * Ноль вместо номера не подставляем (Р-086, QA-05). Грабля, из-за которой
   * одного удаления `?? 0` было бы мало: `Number(null)` это **0**, то есть
   * приведение подставляет ноль само. Поэтому проверка стоит ДО него.
   *
   * Колонка `NOT NULL`, так что пустое значение означает сломанную строку, а
   * не «пользователь без номера». Называем это в логе — молча показать
   * прочерк значило бы потерять аномалию.
   */
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
    locale: row.locale === 'en' ? 'en' : 'ru',
    // `vip_level` — `INT NOT NULL DEFAULT 0`, и ноль здесь НАСТОЯЩЕЕ
    // значение: «уровня нет». Это не подстановка, и прочерк был бы здесь
    // неправдой наоборот. Приведение оставлено осознанно.
    vipLevel: Number(row.vip_level),
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
