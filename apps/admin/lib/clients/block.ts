import type { PoolClient } from 'pg';
import { getPool, type Queryable } from '../db';
import { appendJournalEntry } from '../journal/journal';

export type BlockAction = 'block' | 'unblock';

export interface BlockInput {
  operatorId: string;
  userId: string;
  action: BlockAction;
  reason: string;
}

export type BlockResult =
  | { ok: true; blocked: boolean; journalSeq: number }
  | { ok: false; reason: 'missingReason' }
  | { ok: false; reason: 'noClient' }
  | { ok: false; reason: 'alreadyInState' };

const ACTIONS: Record<BlockAction, string> = {
  block: 'client.block',
  unblock: 'client.unblock',
};

export type BlockTxOutcome =
  | { applied: true; blocked: boolean; journalSeq: number; sessionsRevoked: number }
  | { applied: false; reason: 'alreadyInState' };

export async function revokeClientSessionsWithinTx(db: Queryable, userId: string): Promise<number> {
  const res = await db.query(`DELETE FROM sessions WHERE user_id = $1 RETURNING id`, [userId]);
  return res.rows.length;
}

export async function applyClientBlockWithinTx(
  db: Queryable,
  input: { operatorId: string; userId: string; action: BlockAction; reason: string },
): Promise<BlockTxOutcome> {
  const targetBlocked = input.action === 'block';

  const cur = await db.query(`SELECT blocked FROM client_blocks WHERE user_id = $1 FOR UPDATE`, [
    input.userId,
  ]);
  const currentlyBlocked = cur.rows[0] ? Boolean((cur.rows[0] as { blocked: boolean }).blocked) : false;
  if (currentlyBlocked === targetBlocked) {
    return { applied: false, reason: 'alreadyInState' };
  }

  await db.query(
    `INSERT INTO client_blocks (user_id, blocked, reason, blocked_by, updated_at)
          VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_id) DO UPDATE
          SET blocked = EXCLUDED.blocked,
              reason = EXCLUDED.reason,
              blocked_by = EXCLUDED.blocked_by,
              updated_at = now()`,
    [input.userId, targetBlocked, input.reason, input.operatorId],
  );

  const sessionsRevoked = targetBlocked ? await revokeClientSessionsWithinTx(db, input.userId) : 0;

  const entry = await appendJournalEntry(
    {
      operatorId: input.operatorId,
      action: ACTIONS[input.action],
      subjectKind: 'client',
      subjectId: input.userId,
      payload: targetBlocked
        ? { basis: input.reason, previousBlocked: currentlyBlocked, sessionsRevoked }
        : { basis: input.reason, previousBlocked: currentlyBlocked },
    },
    db,
  );

  const seqRow = await db.query(`SELECT seq FROM admin_action_journal WHERE entry_hash = $1`, [
    entry.entryHash,
  ]);
  const journalSeq = Number((seqRow.rows[0] as { seq: number | string } | undefined)?.seq);
  if (!Number.isFinite(journalSeq)) {
    throw new Error('не удалось получить seq записи журнала блокировки');
  }

  await db.query(`UPDATE client_blocks SET last_journal_seq = $2 WHERE user_id = $1`, [
    input.userId,
    journalSeq,
  ]);

  return { applied: true, blocked: targetBlocked, journalSeq, sessionsRevoked };
}

export async function setClientBlock(
  input: BlockInput,
  pool: { connect(): Promise<PoolClient> } = getPool(),
): Promise<BlockResult> {
  const reason = input.reason?.trim() ?? '';
  if (reason.length === 0) {
    return { ok: false, reason: 'missingReason' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const exists = await client.query(`SELECT 1 FROM users WHERE id = $1`, [input.userId]);
    if (exists.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'noClient' };
    }

    const outcome = await applyClientBlockWithinTx(client as unknown as Queryable, {
      operatorId: input.operatorId,
      userId: input.userId,
      action: input.action,
      reason,
    });
    if (!outcome.applied) {
      await client.query('ROLLBACK');
      return { ok: false, reason: outcome.reason };
    }

    await client.query('COMMIT');
    return { ok: true, blocked: outcome.blocked, journalSeq: outcome.journalSeq };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export interface RevokeSessionsInput {
  operatorId: string;
  userId: string;
  reason: string;
}

export type RevokeSessionsResult =
  | { ok: true; revoked: number; journalSeq: number }
  | { ok: false; reason: 'missingReason' }
  | { ok: false; reason: 'noClient' };

export async function revokeClientSessions(
  input: RevokeSessionsInput,
  pool: { connect(): Promise<PoolClient> } = getPool(),
): Promise<RevokeSessionsResult> {
  const reason = input.reason?.trim() ?? '';
  if (reason.length === 0) return { ok: false, reason: 'missingReason' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const exists = await client.query(`SELECT 1 FROM users WHERE id = $1`, [input.userId]);
    if (exists.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'noClient' };
    }

    const db = client as unknown as Queryable;
    const revoked = await revokeClientSessionsWithinTx(db, input.userId);
    const entry = await appendJournalEntry(
      {
        operatorId: input.operatorId,
        action: 'client.sessions_revoked',
        subjectKind: 'client',
        subjectId: input.userId,
        payload: { basis: reason, revoked },
      },
      db,
    );
    const seqRow = await db.query(`SELECT seq FROM admin_action_journal WHERE entry_hash = $1`, [
      entry.entryHash,
    ]);
    const journalSeq = Number((seqRow.rows[0] as { seq: number | string } | undefined)?.seq);

    await client.query('COMMIT');
    return { ok: true, revoked, journalSeq };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
