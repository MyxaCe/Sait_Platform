import type { PoolClient } from 'pg';
import { getPool } from '../db';
import { appendJournalEntry } from '../journal/journal';
import type { OperatorSession } from './session';
import { TOTP_DEFAULTS, verifyTotp } from './totp';

export type TotpStepResult = { ok: true; session: OperatorSession } | { ok: false };

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
  if (!verifyTotp(row.totp_secret, code, { window: TOTP_DEFAULTS.window })) {
    console.error(`[admin-login] 2FA отказ: неверный код (login=${row.login})`);
    return { ok: false };
  }

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

export async function saveOperatorTotpSecret(
  operatorId: string,
  login: string,
  secretBase32: string,
  pool: { connect(): Promise<PoolClient> } = getPool(),
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE operators
          SET totp_secret = $1, totp_enrolled_at = now()
        WHERE id = $2 AND disabled_at IS NULL
      RETURNING id`,
      [secretBase32, operatorId],
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
