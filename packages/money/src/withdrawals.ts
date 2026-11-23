import { inTransaction, isUniqueViolation, rollback, type PoolLike, type Queryable } from './db';
import { appendJournalSeqWithinTx } from './journal';
import { resolveKycAllowance } from './kyc-allowance';
import { computeMoneyPolicy, loadMoneyPolicyInputs, type MoneyPolicyReason } from './policy';
import { SYSTEM_OPERATORS } from './system-operators';
import { externalRef } from './terminal-contract';
import type { MoneyMoveOutcome, TerminalMoneyClient } from './terminal-money';
import { isValidTronAddress, normalizeTxHash } from './tron';
import { lockWithdrawModeWithinTx, readWithdrawMode } from './withdraw-mode';

export type WithdrawalStatus =
  | 'requested'
  | 'approved'
  | 'sent'
  | 'settled'
  | 'needs_review'
  | 'rejected'
  | 'cancelled';

export type DebitState = 'pending' | 'debited' | 'refused';

export type RequestResult =
  | { ok: true; withdrawalId: string; debit: 'debited' | 'pending' }
  | { ok: false; reason: 'invalidAddress' | 'belowMinimum' | 'invalidAmount' }
  | { ok: false; reason: 'policy'; policyReasons: MoneyPolicyReason[] }
  | { ok: false; reason: 'kycLimitExceeded'; limitMinor: number; usedMinor: number; remainingMinor: number }
  | { ok: false; reason: 'kycLimitUnavailable' }
  | { ok: false; reason: 'terminalRefused'; code: string; withdrawalId: string };

function moneyPayload(outcome: MoneyMoveOutcome): Record<string, unknown> {
  return outcome.state === 'ok'
    ? { terminalSeq: outcome.seq, balanceMinor: outcome.balanceMinor, replay: outcome.replay }
    : {};
}

async function bindSeq(tx: Queryable, id: string, seq: number): Promise<void> {
  await tx.query(`UPDATE crypto_withdrawals SET last_journal_seq = $2 WHERE id = $1`, [id, seq]);
}

export async function requestWithdrawal(
  pool: PoolLike,
  terminal: TerminalMoneyClient,
  input: { userId: string; toAddress: string; amountMinor: number },
): Promise<RequestResult> {
  const toAddress = input.toAddress.trim();
  if (!isValidTronAddress(toAddress)) return { ok: false, reason: 'invalidAddress' };
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    return { ok: false, reason: 'invalidAmount' };
  }

  const created = await inTransaction<RequestResult | { id: string }>(pool, async (tx) => {
    const policy = computeMoneyPolicy(await loadMoneyPolicyInputs(tx, input.userId));
    if (!policy.withdrawAllowed) {
      return rollback<RequestResult | { id: string }>({
        ok: false,
        reason: 'policy',
        policyReasons: policy.withdrawReasons,
      });
    }
    if (input.amountMinor < policy.minWithdrawMinor) {
      return rollback<RequestResult | { id: string }>({ ok: false, reason: 'belowMinimum' });
    }
    if (policy.withdrawKycLimited) {
      await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `wd-kyc-allowance:${input.userId}`,
      ]);
      const allowance = await resolveKycAllowance(tx, terminal, input.userId, policy.unverifiedWithdraw.bps).catch(
        () => null,
      );
      if (!allowance) {
        return rollback<RequestResult | { id: string }>({ ok: false, reason: 'kycLimitUnavailable' });
      }
      if (input.amountMinor > allowance.remainingMinor) {
        return rollback<RequestResult | { id: string }>({
          ok: false,
          reason: 'kycLimitExceeded',
          limitMinor: allowance.limitMinor,
          usedMinor: allowance.usedMinor,
          remainingMinor: allowance.remainingMinor,
        });
      }
    }
    const ins = await tx.query(
      `INSERT INTO crypto_withdrawals (user_id, to_address, amount_minor, status, debit_state)
            VALUES ($1, $2, $3, 'requested', 'pending')
       RETURNING id`,
      [input.userId, toAddress, input.amountMinor],
    );
    const id = ins.rows[0]!.id as string;
    const seq = await appendJournalSeqWithinTx(
      {
        operatorId: SYSTEM_OPERATORS.cabinet,
        action: 'crypto.withdrawal.requested',
        subjectKind: 'client',
        subjectId: input.userId,
        payload: {
          withdrawalId: id,
          toAddress,
          amountMinor: input.amountMinor,
          ...(policy.withdrawKycLimited ? { kycAllowanceBps: policy.unverifiedWithdraw.bps } : {}),
        },
      },
      tx,
    );
    await bindSeq(tx, id, seq);
    return { id };
  });
  if ('ok' in created) return created;

  const debit = await ensureWithdrawalDebited(pool, terminal, created.id);
  if (debit.state === 'refused') {
    return { ok: false, reason: 'terminalRefused', code: debit.code, withdrawalId: created.id };
  }
  return { ok: true, withdrawalId: created.id, debit: debit.state === 'debited' ? 'debited' : 'pending' };
}

export type DebitOutcome =
  | { state: 'debited' }
  | { state: 'refused'; code: string }
  | { state: 'pending' }
  | { state: 'not-found' };

export async function ensureWithdrawalDebited(
  pool: PoolLike,
  terminal: TerminalMoneyClient,
  withdrawalId: string,
): Promise<DebitOutcome> {
  return inTransaction<DebitOutcome>(pool, async (tx) => {
    const cur = await tx.query(
      `SELECT user_id, amount_minor, status, debit_state, reject_reason
         FROM crypto_withdrawals WHERE id = $1 FOR UPDATE`,
      [withdrawalId],
    );
    const row = cur.rows[0];
    if (!row) return rollback<DebitOutcome>({ state: 'not-found' });
    if (row.debit_state === 'debited') return rollback<DebitOutcome>({ state: 'debited' });
    if (row.debit_state === 'refused') {
      return rollback<DebitOutcome>({ state: 'refused', code: String(row.reject_reason ?? 'refused') });
    }
    if (row.status !== 'requested') return rollback<DebitOutcome>({ state: 'pending' });

    const userId = row.user_id as string;
    const outcome = await terminal.withdraw(userId, {
      amount_minor: Number(row.amount_minor),
      external_ref: externalRef.withdraw(withdrawalId),
      operator: 'site:cabinet',
      reason: `Вывод USDT TRC20, заявка ${withdrawalId}`,
    });

    if (outcome.state === 'unavailable') {
      await tx.query(
        `UPDATE crypto_withdrawals SET check_note = $2, last_checked_at = now() WHERE id = $1`,
        [withdrawalId, `списание не подтверждено: терминал ${outcome.reason}`],
      );
      return { state: 'pending' };
    }

    if (outcome.state === 'refused') {
      await tx.query(
        `UPDATE crypto_withdrawals
            SET status = 'rejected', debit_state = 'refused', reject_reason = $2, updated_at = now()
          WHERE id = $1 AND status = 'requested' AND debit_state = 'pending'`,
        [withdrawalId, outcome.code],
      );
      const seq = await appendJournalSeqWithinTx(
        {
          operatorId: SYSTEM_OPERATORS.cabinet,
          action: 'crypto.withdrawal.refused',
          subjectKind: 'client',
          subjectId: userId,
          payload: { withdrawalId, code: outcome.code },
        },
        tx,
      );
      await bindSeq(tx, withdrawalId, seq);
      return { state: 'refused', code: outcome.code };
    }

    await tx.query(
      `UPDATE crypto_withdrawals
          SET debit_state = 'debited', debit_seq = $2, check_note = NULL, updated_at = now()
        WHERE id = $1 AND debit_state = 'pending'`,
      [withdrawalId, outcome.seq],
    );
    const seq = await appendJournalSeqWithinTx(
      {
        operatorId: SYSTEM_OPERATORS.cabinet,
        action: 'crypto.withdrawal.debited',
        subjectKind: 'client',
        subjectId: userId,
        payload: { withdrawalId, amountMinor: Number(row.amount_minor), ...moneyPayload(outcome) },
      },
      tx,
    );
    await bindSeq(tx, withdrawalId, seq);
    return { state: 'debited' };
  });
}

export interface OperatorInput {
  withdrawalId: string;
  operatorId: string;
  operatorLogin: string;
  reason: string;
}

export type OperatorResult =
  | { ok: true; status: WithdrawalStatus }
  | {
      ok: false;
      reason:
        | 'missingReason'
        | 'notFound'
        | 'wrongState'
        | 'debitPending'
        | 'terminalUnavailable'
        | 'invalidHash'
        | 'hashUsed'
        | 'withdrawalsStopped';
    }
  | { ok: false; reason: 'terminalRefused'; code: string };

export async function approveWithdrawal(
  pool: PoolLike,
  terminal: TerminalMoneyClient,
  input: OperatorInput,
): Promise<OperatorResult> {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, reason: 'missingReason' };
  // Быстрый отказ без обращения к терминалу; решающая проверка — ниже, в транзакции.
  if ((await readWithdrawMode(pool)).mode === 'stop') return { ok: false, reason: 'withdrawalsStopped' };

  const debit = await ensureWithdrawalDebited(pool, terminal, input.withdrawalId);
  if (debit.state === 'not-found') return { ok: false, reason: 'notFound' };
  if (debit.state === 'pending') return { ok: false, reason: 'debitPending' };
  if (debit.state === 'refused') return { ok: false, reason: 'wrongState' };

  return inTransaction<OperatorResult>(pool, async (tx) => {
    if ((await lockWithdrawModeWithinTx(tx)) === 'stop') {
      return rollback<OperatorResult>({ ok: false, reason: 'withdrawalsStopped' });
    }
    const upd = await tx.query(
      `UPDATE crypto_withdrawals
          SET status = 'approved', decided_by = $2, updated_at = now()
        WHERE id = $1 AND status = 'requested' AND debit_state = 'debited'
       RETURNING user_id, amount_minor, to_address`,
      [input.withdrawalId, input.operatorId],
    );
    const row = upd.rows[0];
    if (!row) return rollback<OperatorResult>({ ok: false, reason: 'wrongState' });
    const seq = await appendJournalSeqWithinTx(
      {
        operatorId: input.operatorId,
        action: 'crypto.withdrawal.approved',
        subjectKind: 'client',
        subjectId: row.user_id as string,
        payload: {
          basis: reason,
          withdrawalId: input.withdrawalId,
          amountMinor: Number(row.amount_minor),
          toAddress: row.to_address,
        },
      },
      tx,
    );
    await bindSeq(tx, input.withdrawalId, seq);
    return { ok: true, status: 'approved' };
  });
}

export async function rejectWithdrawal(
  pool: PoolLike,
  terminal: TerminalMoneyClient,
  input: OperatorInput,
): Promise<OperatorResult> {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, reason: 'missingReason' };

  const debit = await ensureWithdrawalDebited(pool, terminal, input.withdrawalId);
  if (debit.state === 'not-found') return { ok: false, reason: 'notFound' };
  if (debit.state === 'refused') return { ok: true, status: 'rejected' };
  if (debit.state === 'pending') {
    const st = await pool.query(`SELECT status, debit_state FROM crypto_withdrawals WHERE id = $1`, [
      input.withdrawalId,
    ]);
    if (st.rows[0]?.debit_state === 'pending') return { ok: false, reason: 'debitPending' };
  }

  return inTransaction<OperatorResult>(pool, async (tx) => {
    const cur = await tx.query(
      `SELECT user_id, amount_minor, status, debit_state FROM crypto_withdrawals WHERE id = $1 FOR UPDATE`,
      [input.withdrawalId],
    );
    const row = cur.rows[0];
    if (!row) return rollback<OperatorResult>({ ok: false, reason: 'notFound' });
    const status = row.status as WithdrawalStatus;
    if (!['requested', 'approved', 'needs_review'].includes(status)) {
      return rollback<OperatorResult>({ ok: false, reason: 'wrongState' });
    }
    if (row.debit_state === 'pending') return rollback<OperatorResult>({ ok: false, reason: 'debitPending' });
    const target: WithdrawalStatus = status === 'requested' ? 'rejected' : 'cancelled';
    const userId = row.user_id as string;

    let refund: MoneyMoveOutcome | null = null;
    if (row.debit_state === 'debited') {
      refund = await terminal.deposit(userId, {
        amount_minor: Number(row.amount_minor),
        external_ref: externalRef.withdrawRefund(input.withdrawalId),
        operator: input.operatorLogin,
        reason: `Возврат по заявке на вывод ${input.withdrawalId}: ${reason}`,
      });
      if (refund.state === 'refused') {
        return rollback<OperatorResult>({ ok: false, reason: 'terminalRefused', code: refund.code });
      }
      if (refund.state === 'unavailable') {
        return rollback<OperatorResult>({ ok: false, reason: 'terminalUnavailable' });
      }
    }

    const upd = await tx.query(
      `UPDATE crypto_withdrawals
          SET status = $2, reject_reason = $3, decided_by = $4,
              refund_seq = $5, refunded_at = CASE WHEN $6 THEN now() ELSE refunded_at END,
              updated_at = now()
        WHERE id = $1 AND status = $7
       RETURNING id`,
      [
        input.withdrawalId,
        target,
        reason,
        input.operatorId,
        refund?.state === 'ok' ? refund.seq : null,
        refund !== null,
        status,
      ],
    );
    if (!upd.rows[0]) return rollback<OperatorResult>({ ok: false, reason: 'wrongState' });
    const seq = await appendJournalSeqWithinTx(
      {
        operatorId: input.operatorId,
        action: target === 'rejected' ? 'crypto.withdrawal.rejected' : 'crypto.withdrawal.cancelled',
        subjectKind: 'client',
        subjectId: userId,
        payload: {
          basis: reason,
          withdrawalId: input.withdrawalId,
          previousStatus: status,
          refunded: refund !== null,
          amountMinor: Number(row.amount_minor),
          ...(refund ? { refund: moneyPayload(refund) } : {}),
        },
      },
      tx,
    );
    await bindSeq(tx, input.withdrawalId, seq);
    return { ok: true, status: target };
  });
}

export async function markWithdrawalSent(
  pool: PoolLike,
  input: OperatorInput & { txHash: string },
): Promise<OperatorResult> {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, reason: 'missingReason' };
  const txHash = normalizeTxHash(input.txHash);
  if (!txHash) return { ok: false, reason: 'invalidHash' };

  try {
    return await inTransaction<OperatorResult>(pool, async (tx) => {
      if ((await lockWithdrawModeWithinTx(tx)) === 'stop') {
        return rollback<OperatorResult>({ ok: false, reason: 'withdrawalsStopped' });
      }
      const dep = await tx.query(`SELECT 1 FROM crypto_deposits WHERE tx_hash = $1`, [txHash]);
      if (dep.rows.length > 0) return rollback<OperatorResult>({ ok: false, reason: 'hashUsed' });
      const upd = await tx.query(
        `UPDATE crypto_withdrawals
            SET status = 'sent', payout_tx_hash = $2, sent_at = now(), updated_at = now()
          WHERE id = $1 AND status = 'approved'
         RETURNING user_id`,
        [input.withdrawalId, txHash],
      );
      const row = upd.rows[0];
      if (!row) return rollback<OperatorResult>({ ok: false, reason: 'wrongState' });
      const seq = await appendJournalSeqWithinTx(
        {
          operatorId: input.operatorId,
          action: 'crypto.withdrawal.sent',
          subjectKind: 'client',
          subjectId: row.user_id as string,
          payload: { basis: reason, withdrawalId: input.withdrawalId, txHash },
        },
        tx,
      );
      await bindSeq(tx, input.withdrawalId, seq);
      return { ok: true, status: 'sent' };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: 'hashUsed' };
    throw error;
  }
}

export async function settleWithdrawal(
  pool: PoolLike,
  input: { withdrawalId: string; fromAddress: string | null },
): Promise<boolean> {
  return inTransaction<boolean>(pool, async (tx) => {
    const upd = await tx.query(
      `UPDATE crypto_withdrawals
          SET status = 'settled', settled_at = now(), updated_at = now(), check_note = NULL,
              last_checked_at = now()
        WHERE id = $1 AND status = 'sent'
       RETURNING user_id, payout_tx_hash, amount_minor`,
      [input.withdrawalId],
    );
    const row = upd.rows[0];
    if (!row) return rollback(false);
    const seq = await appendJournalSeqWithinTx(
      {
        operatorId: SYSTEM_OPERATORS.chainWatcher,
        action: 'crypto.withdrawal.settled',
        subjectKind: 'client',
        subjectId: row.user_id as string,
        payload: {
          withdrawalId: input.withdrawalId,
          txHash: row.payout_tx_hash,
          amountMinor: Number(row.amount_minor),
          fromAddress: input.fromAddress,
        },
      },
      tx,
    );
    await bindSeq(tx, input.withdrawalId, seq);
    return true;
  });
}

export async function flagWithdrawalForReview(
  pool: PoolLike,
  input: { withdrawalId: string; reason: string },
): Promise<boolean> {
  return inTransaction<boolean>(pool, async (tx) => {
    const upd = await tx.query(
      `UPDATE crypto_withdrawals
          SET status = 'needs_review', review_reason = $2, updated_at = now(), last_checked_at = now()
        WHERE id = $1 AND status = 'sent'
       RETURNING user_id, payout_tx_hash`,
      [input.withdrawalId, input.reason],
    );
    const row = upd.rows[0];
    if (!row) return rollback(false);
    const seq = await appendJournalSeqWithinTx(
      {
        operatorId: SYSTEM_OPERATORS.chainWatcher,
        action: 'crypto.withdrawal.needs_review',
        subjectKind: 'client',
        subjectId: row.user_id as string,
        payload: { withdrawalId: input.withdrawalId, txHash: row.payout_tx_hash, reason: input.reason },
      },
      tx,
    );
    await bindSeq(tx, input.withdrawalId, seq);
    return true;
  });
}

export async function settleWithdrawalManually(
  pool: PoolLike,
  input: OperatorInput,
): Promise<OperatorResult> {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, reason: 'missingReason' };
  return inTransaction<OperatorResult>(pool, async (tx) => {
    const upd = await tx.query(
      `UPDATE crypto_withdrawals
          SET status = 'settled', settled_at = now(), decided_by = $2, updated_at = now()
        WHERE id = $1 AND status = 'needs_review'
       RETURNING user_id`,
      [input.withdrawalId, input.operatorId],
    );
    const row = upd.rows[0];
    if (!row) return rollback<OperatorResult>({ ok: false, reason: 'wrongState' });
    const seq = await appendJournalSeqWithinTx(
      {
        operatorId: input.operatorId,
        action: 'crypto.withdrawal.settled_manually',
        subjectKind: 'client',
        subjectId: row.user_id as string,
        payload: { basis: reason, withdrawalId: input.withdrawalId },
      },
      tx,
    );
    await bindSeq(tx, input.withdrawalId, seq);
    return { ok: true, status: 'settled' };
  });
}

export async function noteWithdrawalCheck(db: Queryable, withdrawalId: string, note: string): Promise<void> {
  await db.query(
    `UPDATE crypto_withdrawals SET check_note = $2, last_checked_at = now() WHERE id = $1`,
    [withdrawalId, note.slice(0, 300)],
  );
}
