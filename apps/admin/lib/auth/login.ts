import { getPool } from '../db';
import { hashPassword, needsRehash, verifyPassword } from './password';
import type { OperatorSession } from './session';

export type CredentialsResult =
  | {
      ok: true;
      session: OperatorSession;
      totpSecret: string | null;
    }
  | { ok: false };

const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c29tZS1kdW1teS1zYWx0LXZhbA$3QmQk6Qp0m5m0m5m0m5m0m5m0m5m0m5m0m5m0m5m0m4';

interface OperatorRow {
  id: string;
  login: string;
  display_name: string;
  role: string;
  password_hash: string | null;
  disabled_at: Date | null;
  totp_secret: string | null;
}

function asRole(value: string): OperatorSession['role'] | null {
  return value === 'admin' || value === 'operator' ? value : null;
}

export async function verifyOperatorCredentials(
  login: string,
  password: string,
): Promise<CredentialsResult> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, login, display_name, role, password_hash, disabled_at, totp_secret
       FROM operators WHERE login = $1`,
    [login],
  );
  const row = result.rows[0] as OperatorRow | undefined;

  const hash = row?.password_hash ?? null;
  const passwordOk = await verifyPassword(password, hash ?? DUMMY_HASH);

  if (!row || !hash) {
    console.error(`[admin-login] отказ: ${row ? 'пустой password_hash' : 'нет логина'} (login=${login})`);
    return { ok: false };
  }
  if (!passwordOk) {
    console.error(`[admin-login] отказ: неверный пароль (login=${login})`);
    return { ok: false };
  }
  if (row.disabled_at !== null) {
    console.error(`[admin-login] отказ: оператор отключён (login=${login})`);
    return { ok: false };
  }

  const role = asRole(row.role);
  if (!role) {
    console.error(`[admin-login] отказ: неизвестная роль '${row.role}' (login=${login})`);
    return { ok: false };
  }

  if (needsRehash(hash)) {
    try {
      const fresh = await hashPassword(password);
      await pool.query(`UPDATE operators SET password_hash = $1 WHERE id = $2`, [fresh, row.id]);
    } catch (error) {
      console.error(`[admin-login] перехеш не удался (login=${login})`, error);
    }
  }

  return {
    ok: true,
    session: {
      operatorId: row.id,
      login: row.login,
      displayName: row.display_name,
      role,
    },
    totpSecret: row.totp_secret,
  };
}
