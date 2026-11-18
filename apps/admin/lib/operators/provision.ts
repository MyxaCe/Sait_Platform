import type { PoolClient } from 'pg';
import { getPool } from '../db';
import { hashPassword } from '../auth/password';
import { appendJournalEntry } from '../journal/journal';
import type { OperatorRole } from '../auth/session';

export const OPERATOR_PASSWORD_MIN_LENGTH = 12;

function isRole(value: unknown): value is OperatorRole {
  return value === 'admin' || value === 'operator' || value === 'finance_operator' || value === 'support_operator';
}

export interface CreateOperatorInput {
  actorId: string;
  login: string;
  displayName: string;
  role: OperatorRole;
  password: string;
  reason: string;
}

export type CreateOperatorResult =
  | { ok: true; operatorId: string }
  | { ok: false; reason: 'missingFields' | 'missingReason' | 'weakPassword' | 'invalidRole' | 'loginTaken' };

export async function createOperator(
  input: CreateOperatorInput,
  pool: { connect(): Promise<PoolClient> } = getPool(),
): Promise<CreateOperatorResult> {
  const login = input.login.trim();
  const displayName = input.displayName.trim();
  const reason = input.reason.trim();

  if (login.length === 0 || displayName.length === 0) return { ok: false, reason: 'missingFields' };
  if (!isRole(input.role)) return { ok: false, reason: 'invalidRole' };
  if (reason.length === 0) return { ok: false, reason: 'missingReason' };
  if (input.password.length < OPERATOR_PASSWORD_MIN_LENGTH) return { ok: false, reason: 'weakPassword' };

  const passwordHash = await hashPassword(input.password);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let operatorId: string;
    try {
      const inserted = await client.query(
        `INSERT INTO operators (login, display_name, role, password_hash)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [login, displayName, input.role, passwordHash],
      );
      operatorId = inserted.rows[0]!.id as string;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if ((error as { code?: string }).code === '23505') {
        return { ok: false, reason: 'loginTaken' };
      }
      throw error;
    }

    await appendJournalEntry(
      {
        operatorId: input.actorId,
        action: 'operator.created',
        subjectKind: 'operator',
        subjectId: operatorId,
        payload: { login, role: input.role, basis: reason },
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

export interface DisableOperatorInput {
  actorId: string;
  operatorId: string;
  reason: string;
}

export type DisableOperatorResult =
  | { ok: true }
  | { ok: false; reason: 'missingReason' | 'selfDisable' | 'notActive' };

export async function disableOperator(
  input: DisableOperatorInput,
  pool: { connect(): Promise<PoolClient> } = getPool(),
): Promise<DisableOperatorResult> {
  const reason = input.reason.trim();
  if (reason.length === 0) return { ok: false, reason: 'missingReason' };
  if (input.actorId === input.operatorId) return { ok: false, reason: 'selfDisable' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const updated = await client.query(
      `UPDATE operators
          SET disabled_at = now()
        WHERE id = $1 AND disabled_at IS NULL
      RETURNING login`,
      [input.operatorId],
    );
    if (updated.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'notActive' };
    }

    await appendJournalEntry(
      {
        operatorId: input.actorId,
        action: 'operator.disabled',
        subjectKind: 'operator',
        subjectId: input.operatorId,
        payload: { login: updated.rows[0]!.login as string, basis: reason },
      },
      client as unknown as Parameters<typeof appendJournalEntry>[1],
    );

    await client.query('COMMIT');
    return { ok: true };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export interface ChangeOperatorRoleInput {
  actorId: string;
  operatorId: string;
  newRole: OperatorRole;
  reason: string;
}

export type ChangeOperatorRoleResult =
  | { ok: true; from: OperatorRole; to: OperatorRole }
  | { ok: false; reason: 'missingReason' | 'invalidRole' | 'selfRoleChange' | 'notFound' | 'noChange' };

export async function changeOperatorRole(
  input: ChangeOperatorRoleInput,
  pool: { connect(): Promise<PoolClient> } = getPool(),
): Promise<ChangeOperatorRoleResult> {
  const reason = input.reason.trim();
  if (!isRole(input.newRole)) return { ok: false, reason: 'invalidRole' };
  if (reason.length === 0) return { ok: false, reason: 'missingReason' };
  if (input.actorId === input.operatorId) return { ok: false, reason: 'selfRoleChange' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const current = await client.query(
      `SELECT role, login FROM operators WHERE id = $1 FOR UPDATE`,
      [input.operatorId],
    );
    const row = current.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'notFound' };
    }
    const from = row.role as OperatorRole;
    if (!isRole(from)) {
      await client.query('ROLLBACK');
      throw new Error(`operators.role вне допустимого множества: ${String(from)}`);
    }
    if (from === input.newRole) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'noChange' };
    }

    await client.query(`UPDATE operators SET role = $2 WHERE id = $1`, [
      input.operatorId,
      input.newRole,
    ]);

    await appendJournalEntry(
      {
        operatorId: input.actorId,
        action: 'operator.role_changed',
        subjectKind: 'operator',
        subjectId: input.operatorId,
        payload: { login: row.login as string, from, to: input.newRole, basis: reason },
      },
      client as unknown as Parameters<typeof appendJournalEntry>[1],
    );

    await client.query('COMMIT');
    return { ok: true, from, to: input.newRole };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
