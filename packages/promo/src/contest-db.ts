import { appendJournalSeqWithinTx, inTransaction, rollback, SYSTEM_OPERATORS, type PoolLike, type Queryable } from '@broker/money';
import { CONTEST_ACTIONS } from './actions';
import { maskName, rankContest, type ContestEntryFacts, type ContestStanding } from './contest';
import { promoAvailability, type Unavailability } from './eligibility';
import { readPromoSettings, readPromotion, type PromotionRow } from './reader';
import type { ContestRules } from './rules';

/**
 * Конкурс в базе: участие (со сбросом демо-счёта терминалом), база участника
 * по событию сброса, лидерборд.
 */

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

/** Факты участников + ранжирование. Окно сделок: [max(база, старт), min(конец, сейчас)]. */
export async function readContestStandings(
  db: Queryable,
  promo: Pick<PromotionRow, 'id' | 'startsAt' | 'endsAt'>,
  rules: ContestRules,
  now: Date,
): Promise<ContestStanding[]> {
  const until = promo.endsAt && Date.parse(promo.endsAt) < now.getTime() ? promo.endsAt : now.toISOString();
  const r = await db.query(
    `SELECT ce.user_id::text AS user_id, u.full_name, ce.status, ce.joined_at, ce.baseline_minor,
            (cv.state = 'verified') AS kyc,
            COALESCE(t.cnt, 0)::int AS trades, COALESCE(t.pnl, 0)::bigint AS pnl
       FROM contest_entries ce
       JOIN users u ON u.id = ce.user_id
       LEFT JOIN client_verification cv ON cv.user_id = ce.user_id
       LEFT JOIN LATERAL (
         SELECT count(*) AS cnt, sum(dt.realized_pnl_cents) AS pnl
           FROM demo_trades dt
          WHERE dt.user_id = ce.user_id
            AND dt.realized_pnl_cents IS NOT NULL
            AND ce.baseline_at IS NOT NULL
            AND dt.executed_at >= GREATEST(ce.baseline_at, COALESCE($2::timestamptz, ce.baseline_at))
            AND dt.executed_at <= $3::timestamptz
       ) t ON true
      WHERE ce.promotion_id::text = $1`,
    [promo.id, promo.startsAt, until],
  );
  const entries: ContestEntryFacts[] = r.rows.map((row) => ({
    userId: String(row.user_id),
    displayName: String(row.full_name ?? ''),
    status: row.status as ContestEntryFacts['status'],
    joinedAt: iso(row.joined_at),
    baselineMinor: row.baseline_minor === null ? null : Number(row.baseline_minor),
    tradesCount: Number(row.trades),
    pnlMinor: Number(row.pnl),
    kycVerified: row.kyc === true,
  }));
  return rankContest(rules, entries);
}

export type ContestPhase = 'draft' | 'upcoming' | 'running' | 'finished' | 'finalized';

export function contestPhase(promo: Pick<PromotionRow, 'status' | 'startsAt' | 'endsAt'>, hasFinal: boolean, now: Date): ContestPhase {
  if (hasFinal) return 'finalized';
  if (promo.status === 'draft') return 'draft';
  if (promo.startsAt && Date.parse(promo.startsAt) > now.getTime()) return 'upcoming';
  if (promo.endsAt && Date.parse(promo.endsAt) <= now.getTime()) return 'finished';
  return 'running';
}

/** Исход сброса демо от терминала (форма — как у кабинета `resetDemoAccount`). */
export type DemoResetResult =
  | { state: 'accepted' }
  | { state: 'refused'; reason: string | null }
  | { state: 'unavailable'; reason: string };

export type JoinContestResult =
  | { ok: true; status: 'pending_reset' }
  | {
      ok: false;
      reason:
        | Unavailability
        | 'not_found'
        | 'wrong_type'
        | 'already_joined'
        | 'contest_finished'
        | 'reset_refused'
        | 'reset_unavailable';
      detail?: string | null;
    };

/**
 * Вступить в конкурс. Стартовая сумма одинакова у всех: вступление
 * сбрасывает демо-счёт ТЕРМИНАЛОМ (`resetDemo` — кабинетный
 * `resetDemoAccount`, `POST /account/demo-reset`). Порядок:
 *  1. транзакция: строка `pending_reset` + журнал → COMMIT (строка есть ДО
 *     вызова — событие сброса не может обогнать её);
 *  2. сброс в терминале; отказ (`account_not_flat` — есть открытые позиции)
 *     или недоступность → строка `withdrawn`, причина клиенту;
 *  3. базу (`baseline_minor`) поставит консюмер по событию
 *     `terminal.balance.changed` reason=reset (`apps/consumer/src/contest-reset.ts`).
 */
export async function joinContest(
  pool: PoolLike,
  input: { userId: string; promotionId: string; now?: Date },
  resetDemo: (userId: string) => Promise<DemoResetResult>,
): Promise<JoinContestResult> {
  const now = input.now ?? new Date();
  const pre = await inTransaction<JoinContestResult | { go: true }>(pool, async (tx) => {
    const promo = await readPromotion(tx, input.promotionId);
    if (!promo) return rollback<JoinContestResult | { go: true }>({ ok: false, reason: 'not_found' });
    if (promo.type !== 'contest') return rollback<JoinContestResult | { go: true }>({ ok: false, reason: 'wrong_type' });
    const settings = await readPromoSettings(tx);
    const u = await tx.query(`SELECT country FROM users WHERE id::text = $1`, [input.userId]);
    const avail = promoAvailability({
      settings: settings ?? { promotionsEnabled: false, attributionWindowDays: 1, blockedCountries: [] },
      promo,
      clientCountry: (u.rows[0]?.country as string | null) ?? null,
      // Вступать можно и до старта (стартуют все одновременно), но не после конца.
      now: promo.startsAt && Date.parse(promo.startsAt) > now.getTime() ? new Date(Date.parse(promo.startsAt)) : now,
    });
    if (!avail.available) {
      return rollback<JoinContestResult | { go: true }>({
        ok: false,
        reason: avail.reason === 'ended' ? 'contest_finished' : avail.reason,
      });
    }
    const cur = await tx.query(
      `SELECT status FROM contest_entries WHERE promotion_id::text = $1 AND user_id::text = $2 FOR UPDATE`,
      [promo.id, input.userId],
    );
    const status = cur.rows[0]?.status as string | undefined;
    if (status && status !== 'withdrawn') {
      return rollback<JoinContestResult | { go: true }>({ ok: false, reason: 'already_joined' });
    }
    if (status === 'withdrawn') {
      await tx.query(
        `UPDATE contest_entries SET status = 'pending_reset', joined_at = now(), baseline_minor = NULL,
                baseline_at = NULL, disqualified_reason = NULL, updated_at = now()
          WHERE promotion_id::text = $1 AND user_id::text = $2`,
        [promo.id, input.userId],
      );
    } else {
      await tx.query(
        `INSERT INTO contest_entries (promotion_id, user_id, status) VALUES ($1, $2, 'pending_reset')`,
        [promo.id, input.userId],
      );
    }
    await appendJournalSeqWithinTx(
      {
        operatorId: SYSTEM_OPERATORS.cabinet,
        action: CONTEST_ACTIONS.joined,
        subjectKind: 'client',
        subjectId: input.userId,
        payload: { promotionId: promo.id, slug: promo.slug },
      },
      tx,
    );
    return { go: true };
  });
  if ('ok' in pre) return pre;

  const reset = await resetDemo(input.userId).catch(
    (): DemoResetResult => ({ state: 'unavailable', reason: 'network' }),
  );
  if (reset.state === 'accepted') return { ok: true, status: 'pending_reset' };

  await inTransaction(pool, async (tx) => {
    await tx.query(
      `UPDATE contest_entries SET status = 'withdrawn', disqualified_reason = $3, updated_at = now()
        WHERE promotion_id::text = $1 AND user_id::text = $2 AND status = 'pending_reset'`,
      [input.promotionId, input.userId, reset.state === 'refused' ? `reset_refused:${reset.reason ?? ''}` : 'reset_unavailable'],
    );
    await appendJournalSeqWithinTx(
      {
        operatorId: SYSTEM_OPERATORS.cabinet,
        action: CONTEST_ACTIONS.joinFailed,
        subjectKind: 'client',
        subjectId: input.userId,
        payload: { promotionId: input.promotionId, outcome: reset.state, code: reset.reason ?? null },
      },
      tx,
    );
  });
  return reset.state === 'refused'
    ? { ok: false, reason: 'reset_refused', detail: reset.reason }
    : { ok: false, reason: 'reset_unavailable', detail: reset.reason };
}

export { maskName };
