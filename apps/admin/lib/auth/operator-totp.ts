import type { PoolClient } from 'pg';
import { getPool } from '../db';
import { appendJournalEntry } from '../journal/journal';
import type { OperatorSession } from './session';
import { adminTotpKey, openOperatorSecret, requireEncrypted, sealOperatorSecret } from './operator-totp-secret';
import { TOTP_DEFAULTS, verifyTotp } from './totp';

export type TotpStepResult = { ok: true; session: OperatorSession } | { ok: false };

export class OperatorTotpKeyMissingError extends Error {
  constructor() {
    super('ADMIN_TOTP_KEY не задан — секрет 2FA оператора не на чем шифровать');
    this.name = 'OperatorTotpKeyMissingError';
  }
}

export function canEnrollOperatorTotp(): boolean {
  return adminTotpKey() !== null;
}

interface OperatorTotpRow {
  id: string;
  login: string;
  display_name: string;
  role: string;
  totp_secret: string | null;
  disabled_at: Date | null;
}

function asRole(value: string): OperatorSession['role'] | null {
  return value === 'admin' || value === 'operator' ? value : null;
}

export async function isOperatorEnrolled(operatorId: string): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(`SELECT totp_secret FROM operators WHERE id = $1`, [operatorId]);
  const row = result.rows[0] as { totp_secret: string | null } | undefined;
  return !!row && row.totp_secret !== null;
}

export async function verifyOperatorTotpStep(
  operatorId: string,
  code: string,
): Promise<TotpStepResult> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, login, display_name, role, totp_secret, disabled_at
       FROM operators WHERE id = $1`,
    [operatorId],
  );
  const row = result.rows[0] as OperatorTotpRow | undefined;

  if (!row) {
    console.error(`[admin-login] 2FA отказ: нет оператора (id=${operatorId})`);
    return { ok: false };
  }
  if (row.disabled_at !== null) {
    console.error(`[admin-login] 2FA отказ: оператор отключён (login=${row.login})`);
    return { ok: false };
  }
  if (!row.totp_secret) {
    console.error(`[admin-login] 2FA отказ: секрет не задан (login=${row.login})`);
    return { ok: false };
  }
  const role = asRole(row.role);
  if (!role) {
    console.error(`[admin-login] 2FA отказ: неизвестная роль '${row.role}' (login=${row.login})`);
    return { ok: false };
  }
  const key = adminTotpKey();
  const opened = openOperatorSecret(row.totp_secret, key, { requireEncrypted: requireEncrypted() });
  if (!opened.ok) {
    const why =
      opened.reason === 'plaintextRefused'
        ? 'секрет хранится открытым, а ADMIN_TOTP_REQUIRE_ENCRYPTED=1 — запустите scripts/encrypt-operator-totp.mjs'
        : opened.reason === 'noKey'
          ? 'секрет зашифрован, а ADMIN_TOTP_KEY не задан'
          : 'секрет не расшифровывается — проверьте ADMIN_TOTP_KEY';
    console.error(`[admin-login] 2FA отказ: ${why} (login=${row.login})`);
    return { ok: false };
  }
  if (!verifyTotp(opened.secret, code, { window: TOTP_DEFAULTS.window })) {
    console.error(`[admin-login] 2FA отказ: неверный код (login=${row.login})`);
    return { ok: false };
  }
  if (opened.legacy && key) await upgradeLegacySecret(row.id, row.login, row.totp_secret, key);

  return {
    ok: true,
    session: {
      operatorId: row.id,
      login: row.login,
      displayName: row.display_name,
      role,
    },
  };
}

// Открытый секрет → зашифрованный, после успешного входа. Сравнение со старым
// значением в WHERE: если секрет успели сменить (повторное подключение), не трогаем.
// Ошибка перезаписи вход не ломает — строку дошифрует скрипт выката.
async function upgradeLegacySecret(operatorId: string, login: string, legacy: string, key: Buffer): Promise<void> {
  try {
    const result = await getPool().query(
      `UPDATE operators SET totp_secret = $1 WHERE id = $2 AND totp_secret = $3`,
      [sealOperatorSecret(legacy, key), operatorId, legacy],
    );
    if ((result.rowCount ?? 0) > 0) console.info(`[admin-2fa] секрет оператора зашифрован при входе (login=${login})`);
  } catch (error) {
    console.error(`[admin-2fa] секрет оператора не перешифрован при входе (login=${login}):`, error);
  }
}

export async function saveOperatorTotpSecret(
  operatorId: string,
  login: string,
  secretBase32: string,
  pool: { connect(): Promise<PoolClient> } = getPool(),
): Promise<void> {
  const key = adminTotpKey();
  if (!key) throw new OperatorTotpKeyMissingError();
  const sealed = sealOperatorSecret(secretBase32, key);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE operators
          SET totp_secret = $1, totp_enrolled_at = now()
        WHERE id = $2 AND disabled_at IS NULL
      RETURNING id`,
      [sealed, operatorId],
    );
    if (updated.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new Error('enroll: оператор не найден или отключён');
    }

    await appendJournalEntry(
      {
        operatorId,
        action: 'operator.totp_enrolled',
        subjectKind: 'operator',
        subjectId: operatorId,
        payload: { login },
      },
      client as unknown as Parameters<typeof appendJournalEntry>[1],
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
