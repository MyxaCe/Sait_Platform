import type { PoolClient } from 'pg';
import { getPool } from './db';
import { hashPassword } from './auth/password';
import { appendJournalEntry } from './journal/journal';

export interface BootstrapInput {
  login: string;
  displayName: string;
  password: string;
}

export type BootstrapResult =
  | { ok: true; operatorId: string }
  | { ok: false; reason: 'alreadyBootstrapped' };

export async function bootstrapFirstOperator(
  input: BootstrapInput,
  pool: { connect(): Promise<PoolClient> } = getPool(),
): Promise<BootstrapResult> {
  const passwordHash = await hashPassword(input.password);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE operators IN EXCLUSIVE MODE');

    const existing = await client.query(
      `SELECT 1 FROM operators WHERE login NOT LIKE 'system:%' LIMIT 1`,
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'alreadyBootstrapped' };
    }

    const inserted = await client.query(
      `INSERT INTO operators (login, display_name, role, password_hash)
       VALUES ($1, $2, 'admin', $3)
       RETURNING id`,
      [input.login, input.displayName, passwordHash],
    );
    const operatorId = inserted.rows[0].id as string;

    await appendJournalEntry(
      {
        operatorId,
        action: 'operator.bootstrap',
        subjectKind: 'operator',
        subjectId: operatorId,
        payload: { login: input.login, role: 'admin', basis: 'bootstrap' },
      },
      client as unknown as Parameters<typeof appendJournalEntry>[1],
    );

    await client.query('COMMIT');
    return { ok: true, operatorId };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
