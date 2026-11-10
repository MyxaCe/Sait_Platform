import {
  appendJournalSeqWithinTx,
  inTransaction,
  rollback,
  type PoolLike,
  type Queryable,
  type TerminalMoneyClient,
} from '@broker/money';
import { PROMO_ENGINE_OPERATOR, REWARD_ACTIONS, type RewardKind } from './actions';
import type { LinkSignal } from './antifraud';

/**
 * ОЧЕРЕДЬ НАЧИСЛЕНИЙ — единственный путь денег зоны акций (решение владельца
 * 10.11: только через одобрение человеком).
 *
 *   pending ─► approved ─► credited
 *      │          └─► needs_review (терминал отказал) ─► rejected (бюджет освобождён)
 *      │                         └─► approved (повтор после разбора)
 *      └─► rejected
 *
 * **Одобрение** — одна транзакция: строка начисления `FOR UPDATE` (гонка двух
 * одобрений: второе ждёт замок и видит уже `approved` → `wrongState`),
 * резерв бюджета условным UPDATE (`spent + amount ≤ budget`; под READ
 * COMMITTED Postgres перепроверяет условие на свежей версии строки акции,
 * поэтому два параллельных одобрения бюджет не перескочат; CHECK
 * `promotions_budget_not_exceeded` — последний рубеж), журнал той же
 * транзакцией. Затем — зачисление.
 *
 * **Зачисление** (`ensureRewardCredited`, образец `ensureWithdrawalDebited`):
 * терминал `deposit` на реальный счёт с `external_ref` начисления.
 * Ответил — `credited` (повтор ref → тот же seq, идемпотентно). Отказал —
 * `needs_review` (человек разбирается, бюджет остаётся зарезервированным).
 * Не ответил — остаётся `approved` («исход неизвестен»), повтор тем же ref
 * безопасен. Отклонить `approved` нельзя: деньги могли уйти.
 */

export type RewardStatus = 'pending' | 'approved' | 'credited' | 'needs_review' | 'rejected';

export interface RewardDraft {
  kind: RewardKind;
  promotionId: string | null;
  ibPartnerId?: string | null;
  participationId?: string | null;
  userId: string;
  relatedUserId?: string | null;
  amountMinor: number;
  period?: string | null;
  externalRef: string;
  /** Основание расчёта (формула, факты) — для оператора и аудита. */
  basis: Record<string, unknown>;
  signals: LinkSignal[];
}

/** Поставить начисление в очередь (идемпотентно по external_ref). Внутри транзакции. */
export async function enqueueRewardWithinTx(
  tx: Queryable,
  draft: RewardDraft,
): Promise<{ created: boolean; id: string | null }> {
  if (!Number.isSafeInteger(draft.amountMinor) || draft.amountMinor <= 0) return { created: false, id: null };
  const ins = await tx.query(
    `INSERT INTO promo_rewards
       (kind, promotion_id, ib_partner_id, participation_id, user_id, related_user_id,
        amount_minor, period, external_ref, basis, signals, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending')
     ON CONFLICT (external_ref) DO NOTHING
     RETURNING id::text AS id`,
    [
      draft.kind,
      draft.promotionId,
      draft.ibPartnerId ?? null,
      draft.participationId ?? null,
      draft.userId,
      draft.relatedUserId ?? null,
      draft.amountMinor,
      draft.period ?? null,
      draft.externalRef,
      JSON.stringify(draft.basis),
      JSON.stringify(draft.signals),
    ],
  );
  const id = ins.rows[0]?.id as string | undefined;
  if (!id) return { created: false, id: null };
  const seq = await appendJournalSeqWithinTx(
    {
      operatorId: PROMO_ENGINE_OPERATOR,
      action: REWARD_ACTIONS[draft.kind].queued,
      subjectKind: 'client',
      subjectId: draft.userId,
      payload: {
        rewardId: id,
        externalRef: draft.externalRef,
        amountMinor: draft.amountMinor,
        promotionId: draft.promotionId,
        ibPartnerId: draft.ibPartnerId ?? null,
        relatedUserId: draft.relatedUserId ?? null,
        period: draft.period ?? null,
        signals: draft.signals.map((s) => s.kind),
      },
    },
    tx,
  );
  await tx.query(`UPDATE promo_rewards SET last_journal_seq = $2 WHERE id = $1`, [id, seq]);
  return { created: true, id };
}

interface LockedReward {
  id: string;
  kind: RewardKind;
  promotionId: string | null;
  participationId: string | null;
  userId: string;
  amountMinor: number;
  status: RewardStatus;
  externalRef: string;
  decidedBy: string | null;
  decisionReason: string | null;
}

async function lockReward(tx: Queryable, rewardId: string): Promise<LockedReward | null> {
  const r = await tx.query(
    `SELECT id::text AS id, kind, promotion_id::text AS promotion_id, participation_id::text AS participation_id,
            user_id::text AS user_id, amount_minor, status, external_ref,
            decided_by::text AS decided_by, decision_reason
       FROM promo_rewards WHERE id::text = $1 FOR UPDATE`,
    [rewardId],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    kind: row.kind as RewardKind,
    promotionId: (row.promotion_id as string | null) ?? null,
    participationId: (row.participation_id as string | null) ?? null,
    userId: String(row.user_id),
    amountMinor: Number(row.amount_minor),
    status: row.status as RewardStatus,
    externalRef: String(row.external_ref),
    decidedBy: (row.decided_by as string | null) ?? null,
    decisionReason: (row.decision_reason as string | null) ?? null,
  };
}

async function bindSeq(tx: Queryable, id: string, seq: number): Promise<void> {
  await tx.query(`UPDATE promo_rewards SET last_journal_seq = $2 WHERE id = $1`, [id, seq]);
}

export type CreditOutcome =
  | { state: 'credited'; terminalSeq: number | null; replay: boolean }
  | { state: 'pending'; reason: string }
  | { state: 'needs_review'; code: string }
  | { state: 'not-approved'; status: RewardStatus }
  | { state: 'not-found' };

export type ApproveResult =
  | { ok: true; credit: CreditOutcome }
  | { ok: false; reason: 'missingReason' | 'notFound' | 'wrongState' | 'budgetExceeded' | 'promotionMissing' };

/** Одобрить начисление (admin / finance_operator — проверка роли у вызывающего). */
export async function approveReward(
  pool: PoolLike,
  terminal: Pick<TerminalMoneyClient, 'deposit'>,
  input: { rewardId: string; operatorId: string; operatorLogin: string; reason: string },
): Promise<ApproveResult> {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, reason: 'missingReason' };

  const decided = await inTransaction<ApproveResult | { approved: true }>(pool, async (tx) => {
    const reward = await lockReward(tx, input.rewardId);
    if (!reward) return rollback<ApproveResult | { approved: true }>({ ok: false, reason: 'notFound' });
    if (reward.status !== 'pending') {
      return rollback<ApproveResult | { approved: true }>({ ok: false, reason: 'wrongState' });
    }
    let budget: { budgetMinor: number; spentMinor: number } | null = null;
    if (reward.promotionId) {
      const upd = await tx.query(
        `UPDATE promotions
            SET spent_minor = spent_minor + $2, updated_at = now()
          WHERE id::text = $1 AND spent_minor + $2 <= budget_minor
        RETURNING budget_minor, spent_minor`,
        [reward.promotionId, reward.amountMinor],
      );
      if ((upd.rowCount ?? upd.rows.length) === 0 || upd.rows.length === 0) {
        const exists = await tx.query(`SELECT 1 FROM promotions WHERE id::text = $1`, [reward.promotionId]);
        return rollback<ApproveResult | { approved: true }>({
          ok: false,
          reason: exists.rows.length === 0 ? 'promotionMissing' : 'budgetExceeded',
        });
      }
      budget = { budgetMinor: Number(upd.rows[0]!.budget_minor), spentMinor: Number(upd.rows[0]!.spent_minor) };
    }
    await tx.query(
      `UPDATE promo_rewards
          SET status = 'approved', decided_by = $2, decided_at = now(), decision_reason = $3, updated_at = now()
        WHERE id = $1 AND status = 'pending'`,
      [reward.id, input.operatorId, reason],
    );
    const seq = await appendJournalSeqWithinTx(
      {
        operatorId: input.operatorId,
        action: REWARD_ACTIONS[reward.kind].approved,
        subjectKind: 'client',
        subjectId: reward.userId,
        payload: {
          basis: reason,
          rewardId: reward.id,
          externalRef: reward.externalRef,
          amountMinor: reward.amountMinor,
          promotionId: reward.promotionId,
          ...(budget ? { budgetMinor: budget.budgetMinor, spentAfterMinor: budget.spentMinor } : {}),
        },
      },
      tx,
    );
    await bindSeq(tx, reward.id, seq);
    return { approved: true };
  });
  if ('ok' in decided) return decided;

  const credit = await ensureRewardCredited(pool, terminal, input.rewardId, input.operatorLogin);
  return { ok: true, credit };
}

/**
 * Довести одобренное начисление до известного исхода. Уже `credited` —
 * возвращается без вызова. Безопасно звать повторно (повтор ref идемпотентен).
 */
export async function ensureRewardCredited(
  pool: PoolLike,
  terminal: Pick<TerminalMoneyClient, 'deposit'>,
  rewardId: string,
  operatorLogin: string,
): Promise<CreditOutcome> {
  return inTransaction<CreditOutcome>(pool, async (tx) => {
    const reward = await lockReward(tx, rewardId);
    if (!reward) return rollback<CreditOutcome>({ state: 'not-found' });
    if (reward.status === 'credited') return rollback<CreditOutcome>({ state: 'credited', terminalSeq: null, replay: true });
    if (reward.status !== 'approved') return rollback<CreditOutcome>({ state: 'not-approved', status: reward.status });

    const outcome = await terminal.deposit(reward.userId, {
      amount_minor: reward.amountMinor,
      external_ref: reward.externalRef,
      operator: operatorLogin,
      reason: `Начисление по акции (${reward.externalRef}): ${reward.decisionReason ?? ''}`.slice(0, 500),
    });
    const author = reward.decidedBy ?? PROMO_ENGINE_OPERATOR;

    if (outcome.state === 'unavailable') {
      await tx.query(
        `UPDATE promo_rewards SET check_note = $2, updated_at = now() WHERE id = $1`,
        [reward.id, `зачисление не подтверждено: терминал ${outcome.reason}`],
      );
      return { state: 'pending', reason: outcome.reason };
    }
    if (outcome.state === 'refused') {
      await tx.query(
        `UPDATE promo_rewards SET status = 'needs_review', check_note = $2, updated_at = now()
          WHERE id = $1 AND status = 'approved'`,
        [reward.id, outcome.code],
      );
      const seq = await appendJournalSeqWithinTx(
        {
          operatorId: author,
          action: REWARD_ACTIONS[reward.kind].needsReview,
          subjectKind: 'client',
          subjectId: reward.userId,
          payload: { rewardId: reward.id, externalRef: reward.externalRef, code: outcome.code },
        },
        tx,
      );
      await bindSeq(tx, reward.id, seq);
      return { state: 'needs_review', code: outcome.code };
    }

    await tx.query(
      `UPDATE promo_rewards
          SET status = 'credited', terminal_seq = $2, credited_at = now(), check_note = NULL, updated_at = now()
        WHERE id = $1 AND status = 'approved'`,
      [reward.id, outcome.seq],
    );
    if (reward.participationId) {
      await tx.query(
        `UPDATE promo_participations SET status = 'rewarded', updated_at = now()
          WHERE id::text = $1 AND status IN ('enrolled', 'qualified')`,
        [reward.participationId],
      );
    }
    const seq = await appendJournalSeqWithinTx(
      {
        operatorId: author,
        action: REWARD_ACTIONS[reward.kind].credited,
        subjectKind: 'client',
        subjectId: reward.userId,
        payload: {
          rewardId: reward.id,
          externalRef: reward.externalRef,
          amountMinor: reward.amountMinor,
          terminalSeq: outcome.seq,
          balanceMinor: outcome.balanceMinor,
          replay: outcome.replay,
        },
      },
      tx,
    );
    await bindSeq(tx, reward.id, seq);
    return { state: 'credited', terminalSeq: outcome.seq, replay: outcome.replay };
  });
}

export type RejectResult =
  | { ok: true; releasedMinor: number }
  | { ok: false; reason: 'missingReason' | 'notFound' | 'wrongState' };

/**
 * Отклонить: `pending` (бюджет не трогался) или `needs_review` (бюджет
 * освобождается — терминал деньги не зачислил). `approved` отклонить нельзя.
 */
export async function rejectReward(
  pool: PoolLike,
  input: { rewardId: string; operatorId: string; reason: string },
): Promise<RejectResult> {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, reason: 'missingReason' };
  return inTransaction<RejectResult>(pool, async (tx) => {
    const reward = await lockReward(tx, input.rewardId);
    if (!reward) return rollback<RejectResult>({ ok: false, reason: 'notFound' });
    if (reward.status !== 'pending' && reward.status !== 'needs_review') {
      return rollback<RejectResult>({ ok: false, reason: 'wrongState' });
    }
    let released = 0;
    if (reward.status === 'needs_review' && reward.promotionId) {
      await tx.query(
        `UPDATE promotions SET spent_minor = spent_minor - $2, updated_at = now()
          WHERE id::text = $1 AND spent_minor >= $2`,
        [reward.promotionId, reward.amountMinor],
      );
      released = reward.amountMinor;
    }
    await tx.query(
      `UPDATE promo_rewards
          SET status = 'rejected', reject_reason = $3, decided_by = $2, decided_at = now(),
              decision_reason = COALESCE(decision_reason, $3), updated_at = now()
        WHERE id = $1`,
      [reward.id, input.operatorId, reason],
    );
    if (reward.participationId) {
      await tx.query(
        `UPDATE promo_participations SET status = 'rejected', updated_at = now()
          WHERE id::text = $1 AND status IN ('enrolled', 'qualified')`,
        [reward.participationId],
      );
    }
    const seq = await appendJournalSeqWithinTx(
      {
        operatorId: input.operatorId,
        action: REWARD_ACTIONS[reward.kind].rejected,
        subjectKind: 'client',
        subjectId: reward.userId,
        payload: {
          basis: reason,
          rewardId: reward.id,
          externalRef: reward.externalRef,
          amountMinor: reward.amountMinor,
          from: reward.status,
          releasedMinor: released,
        },
      },
      tx,
    );
    await bindSeq(tx, reward.id, seq);
    return { ok: true, releasedMinor: released };
  });
}

export type RetryResult =
  | { ok: true; credit: CreditOutcome }
  | { ok: false; reason: 'missingReason' | 'notFound' | 'wrongState' };

/**
 * Повторить зачисление: `approved` (исход неизвестен) — просто довести;
 * `needs_review` (после разбора отказа) — вернуть в `approved` с основанием и
 * довести. Бюджет при этом уже зарезервирован.
 */
export async function retryRewardCredit(
  pool: PoolLike,
  terminal: Pick<TerminalMoneyClient, 'deposit'>,
  input: { rewardId: string; operatorId: string; operatorLogin: string; reason: string },
): Promise<RetryResult> {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, reason: 'missingReason' };
  const pre = await inTransaction<RetryResult | { go: true }>(pool, async (tx) => {
    const reward = await lockReward(tx, input.rewardId);
    if (!reward) return rollback<RetryResult | { go: true }>({ ok: false, reason: 'notFound' });
    if (reward.status === 'approved') return rollback<RetryResult | { go: true }>({ go: true });
    if (reward.status !== 'needs_review') return rollback<RetryResult | { go: true }>({ ok: false, reason: 'wrongState' });
    await tx.query(
      `UPDATE promo_rewards SET status = 'approved', decided_by = $2, decision_reason = $3, updated_at = now()
        WHERE id = $1 AND status = 'needs_review'`,
      [reward.id, input.operatorId, reason],
    );
    const seq = await appendJournalSeqWithinTx(
      {
        operatorId: input.operatorId,
        action: REWARD_ACTIONS[reward.kind].approved,
        subjectKind: 'client',
        subjectId: reward.userId,
        payload: { basis: reason, rewardId: reward.id, externalRef: reward.externalRef, retry: true },
      },
      tx,
    );
    await bindSeq(tx, reward.id, seq);
    return { go: true };
  });
  if ('ok' in pre) return pre;
  const credit = await ensureRewardCredited(pool, terminal, input.rewardId, input.operatorLogin);
  return { ok: true, credit };
}
