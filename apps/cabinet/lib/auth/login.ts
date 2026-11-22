import { getPool } from '../db';
import { verifyPassword } from './password';

export type LoginCheck =
  | { ok: true; userId: string; locale: string; mustChangePassword: boolean }
  | { ok: false; error: 'invalidCredentials' | 'accessRestricted' | 'tempPasswordExpired' };

const DUMMY_HASH = '$2a$12$invalidsaltinvalidsaltinvalidsaltinval';

export async function checkLogin(email: string, password: string): Promise<LoginCheck> {
  const r = await getPool().query(
    `SELECT u.id, u.password_hash, u.locale, COALESCE(cb.blocked, false) AS blocked,
            u.password_must_change,
            (u.password_must_change AND u.temp_password_expires_at IS NOT NULL
               AND u.temp_password_expires_at <= now()) AS temp_expired
       FROM users u
       LEFT JOIN client_blocks cb ON cb.user_id = u.id
      WHERE lower(u.email) = lower($1)`,
    [email],
  );
  const row = r.rows[0];
  const ok = row
    ? await verifyPassword(password, row.password_hash)
    : await verifyPassword(password, DUMMY_HASH);
  if (!row || !ok) return { ok: false, error: 'invalidCredentials' };
  if (row.blocked) return { ok: false, error: 'accessRestricted' };
  if (row.temp_expired === true) return { ok: false, error: 'tempPasswordExpired' };
  return {
    ok: true,
    userId: row.id as string,
    locale: String(row.locale ?? 'ru'),
    mustChangePassword: row.password_must_change === true,
  };
}
