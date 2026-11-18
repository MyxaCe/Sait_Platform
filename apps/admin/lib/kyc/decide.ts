import type { PoolClient } from 'pg';
import { getPool } from '../db';
import { appendJournalEntry } from '../journal/journal';

export type VerificationDecision = 'verified' | 'rejected' | 'resubmit_requested';

const REASON_REQUIRED: ReadonlySet<VerificationDecision> = new Set<VerificationDecision>([
  'rejected',
  'resubmit_requested',
]);

export interface DecideInput {
  operatorId: string;
  userId: string;
  decision: VerificationDecision;
  reason?: string;
}

export type DecideResult =
  | { ok: true; state: VerificationDecision; journalSeq: number }
  | { ok: false; reason: 'missingReason' }
  | { ok: false; reason: 'notPending' };

const ACTIONS: Record<VerificationDecision, string> = {
  verified: 'client.verification.verified',
  rejected: 'client.verification.rejected',
  resubmit_requested: 'client.verification.resubmit_requested',
};

export async function decideClientVerification(
  input: DecideInput,
  pool: { connect(): Promise<PoolClient> } = getPool(),
): Promise<DecideResult> {
  const reason = input.reason?.trim() ?? '';
  if (REASON_REQUIRED.has(input.decision) && reason.length === 0) {
    return { ok: false, reason: 'missingReason' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const updated = await client.query(
      `UPDATE client_verification
          SET state = $2, updated_at = now()
        WHERE user_id = $1 AND state = 'pending'
      RETURNING user_id`,
      [input.userId, input.decision],
    );
    if (updated.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'notPending' };
    }

    const entry = await appendJournalEntry(
      {
        operatorId: input.operatorId,
        action: ACTIONS[input.decision],
        subjectKind: 'client',
        subjectId: input.userId,
        payload: { basis: reason === '' ? null : reason, previousState: 'pending' },
      },
      client as unknown as Parameters<typeof appendJournalEntry>[1],
    );

    const seqRow = await client.query(
      `SELECT seq FROM admin_action_journal WHERE entry_hash = $1`,
      [entry.entryHash],
    );
    const journalSeq = Number((seqRow.rows[0] as { seq: number | string } | undefined)?.seq);
    if (!Number.isFinite(journalSeq)) {
      await client.query('ROLLBACK');
      throw new Error('не удалось получить seq записи журнала решения');
    }

    await client.query(
      `UPDATE client_verification SET last_journal_seq = $2 WHERE user_id = $1`,
      [input.userId, journalSeq],
    );

    await client.query('COMMIT');
    return { ok: true, state: input.decision, journalSeq };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
