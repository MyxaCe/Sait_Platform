import type { PoolClient } from 'pg';
import { getPool, type Queryable } from '../db';
import { appendJournalEntry } from '../journal/journal';
import { applyClientBlockWithinTx } from '../clients/block';
import {
  coversAllRequiredForClear,
  normalizeSanctionsLists,
  sanctionsListLabel,
  type AmlOutcome,
  type SanctionsListId,
} from './lists';

export interface RecordScreeningInput {
  operatorId: string;
  userId: string;
  outcome: AmlOutcome;
  listsChecked: readonly SanctionsListId[];
  reason: string;
}

export type RecordScreeningResult =
  | { ok: true; status: AmlOutcome; journalSeq: number; autoBlocked: boolean }
  | { ok: false; reason: 'missingReason' }
  | { ok: false; reason: 'noLists' }
  | { ok: false; reason: 'listsIncompleteForClear' }
  | { ok: false; reason: 'noClient' };

const ACTIONS: Record<AmlOutcome, string> = {
  clear: 'client.aml_checked',
  escalated: 'client.aml_escalated',
};

function escalationBlockReason(lists: readonly SanctionsListId[], reason: string): string {
  const labels = lists.map(sanctionsListLabel).join(', ');
  return `AML: совпадение при скрининге (списки: ${labels}). ${reason}`;
}

async function journalSeqByHash(db: Queryable, entryHash: string): Promise<number> {
  const seqRow = await db.query(`SELECT seq FROM admin_action_journal WHERE entry_hash = $1`, [
    entryHash,
  ]);
  const seq = Number((seqRow.rows[0] as { seq: number | string } | undefined)?.seq);
  if (!Number.isFinite(seq)) {
    throw new Error('не удалось получить seq записи журнала AML');
  }
  return seq;
}

export async function recordAmlScreening(
  input: RecordScreeningInput,
  pool: { connect(): Promise<PoolClient> } = getPool(),
): Promise<RecordScreeningResult> {
  const reason = input.reason?.trim() ?? '';
  if (reason.length === 0) {
    return { ok: false, reason: 'missingReason' };
  }

  const lists = normalizeSanctionsLists(input.listsChecked);
  if (lists.length === 0) {
    return { ok: false, reason: 'noLists' };
  }
  if (input.outcome === 'clear' && !coversAllRequiredForClear(lists)) {
    return { ok: false, reason: 'listsIncompleteForClear' };
  }

  const client = await pool.connect();
  const db = client as unknown as Queryable;
  try {
    await client.query('BEGIN');

    const exists = await client.query(`SELECT 1 FROM users WHERE id = $1`, [input.userId]);
    if (exists.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'noClient' };
    }

    const willBlock = input.outcome === 'escalated';

    await client.query(
      `INSERT INTO client_aml_screening
         (user_id, status, lists_checked, reason, screened_by, screened_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, now(), now())
       ON CONFLICT (user_id) DO UPDATE
            SET status = EXCLUDED.status,
                lists_checked = EXCLUDED.lists_checked,
                reason = EXCLUDED.reason,
                screened_by = EXCLUDED.screened_by,
                screened_at = EXCLUDED.screened_at,
                updated_at = now()`,
      [input.userId, input.outcome, lists, reason, input.operatorId],
    );

    const entry = await appendJournalEntry(
      {
        operatorId: input.operatorId,
        action: ACTIONS[input.outcome],
        subjectKind: 'client',
        subjectId: input.userId,
        payload: { basis: reason, lists, outcome: input.outcome, manual: true, autoBlock: willBlock },
      },
      db,
    );
    const journalSeq = await journalSeqByHash(db, entry.entryHash);

    await client.query(`UPDATE client_aml_screening SET last_journal_seq = $2 WHERE user_id = $1`, [
      input.userId,
      journalSeq,
    ]);

    let autoBlocked = false;
    if (willBlock) {
      const outcome = await applyClientBlockWithinTx(db, {
        operatorId: input.operatorId,
        userId: input.userId,
        action: 'block',
        reason: escalationBlockReason(lists, reason),
      });
      autoBlocked = outcome.applied;
    }

    await client.query('COMMIT');
    return { ok: true, status: input.outcome, journalSeq, autoBlocked };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export interface ClearEscalationInput {
  operatorId: string;
  userId: string;
  reason: string;
}

export type ClearEscalationResult =
  | { ok: true; unblocked: boolean; journalSeq: number }
  | { ok: false; reason: 'missingReason' }
  | { ok: false; reason: 'noClient' }
  | { ok: false; reason: 'notEscalated' };

export async function clearAmlEscalation(
  input: ClearEscalationInput,
  pool: { connect(): Promise<PoolClient> } = getPool(),
): Promise<ClearEscalationResult> {
  const reason = input.reason?.trim() ?? '';
  if (reason.length === 0) {
    return { ok: false, reason: 'missingReason' };
  }

  const client = await pool.connect();
  const db = client as unknown as Queryable;
  try {
    await client.query('BEGIN');

    const exists = await client.query(`SELECT 1 FROM users WHERE id = $1`, [input.userId]);
    if (exists.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'noClient' };
    }

    const cur = await client.query(
      `SELECT status FROM client_aml_screening WHERE user_id = $1 FOR UPDATE`,
      [input.userId],
    );
    const status = (cur.rows[0] as { status: string } | undefined)?.status;
    if (status !== 'escalated') {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'notEscalated' };
    }

    await client.query(
      `UPDATE client_aml_screening
          SET status = 'clear', reason = $2, screened_by = $3, screened_at = now(), updated_at = now()
        WHERE user_id = $1`,
      [input.userId, reason, input.operatorId],
    );

    const entry = await appendJournalEntry(
      {
        operatorId: input.operatorId,
        action: 'client.aml_escalation_cleared',
        subjectKind: 'client',
        subjectId: input.userId,
        payload: { basis: reason, previousStatus: 'escalated', falsePositive: true },
      },
      db,
    );
    const journalSeq = await journalSeqByHash(db, entry.entryHash);

    await client.query(`UPDATE client_aml_screening SET last_journal_seq = $2 WHERE user_id = $1`, [
      input.userId,
      journalSeq,
    ]);

    const unblock = await applyClientBlockWithinTx(db, {
      operatorId: input.operatorId,
      userId: input.userId,
      action: 'unblock',
      reason: `AML: снятие эскалации после ручной проверки. ${reason}`,
    });

    await client.query('COMMIT');
    return { ok: true, unblocked: unblock.applied, journalSeq };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
