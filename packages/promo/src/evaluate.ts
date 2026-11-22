import { DAY_MS, isLiveWithdrawal, ms, type ClientFacts, type DepositFact } from './facts';
import type { CashbackRules, DepositBonusRules, IbCpaRules, ParsedRules, ReferralRules } from './rules';
import { computeTurnover } from './turnover';

export type ConditionKey = 'deposit' | 'kyc' | 'turnover' | 'no_withdrawal' | 'window';

export interface ConditionView {
  key: ConditionKey;
  met: boolean;
  current?: number;
  target?: number;
}

export type EvaluationState = 'in_progress' | 'qualified' | 'expired' | 'not_eligible';

export type EvaluationReason =
  | 'withdrawal'
  | 'window'
  | 'deposit_before_start'
  | 'below_minimum';

export interface Evaluation {
  state: EvaluationState;
  reason?: EvaluationReason;
  conditions: ConditionView[];
  rewardMinor: number | null;
  baseDepositId: string | null;
  windowStart: string;
  deadline: string;
  turnover?: { qualifyingMinor: number; grossMinor: number; shortHolds: number };
}

export interface ConditionSpec {
  kycRequired: boolean;
  minDepositMinor: number;
  firstDepositOnly: boolean;
  turnoverTargetMinor: number | null;
  minHoldSeconds: number;
  windowStart: string;
  windowDays: number;
  forfeitOnWithdrawal: boolean;
  depositNotBefore: string | null;
}

function pickBaseDeposit(
  deposits: readonly DepositFact[],
  spec: ConditionSpec,
  deadlineMs: number,
): { base: DepositFact | null; firstBeforeStart: boolean; belowMinimum: boolean } {
  const sorted = [...deposits].sort((a, b) => ms(a.creditedAt) - ms(b.creditedAt));
  const notBefore = spec.depositNotBefore ? ms(spec.depositNotBefore) : Number.NEGATIVE_INFINITY;
  if (spec.firstDepositOnly) {
    const first = sorted[0];
    if (!first) return { base: null, firstBeforeStart: false, belowMinimum: false };
    if (ms(first.creditedAt) < notBefore) return { base: null, firstBeforeStart: true, belowMinimum: false };
    if (ms(first.creditedAt) > deadlineMs) return { base: null, firstBeforeStart: false, belowMinimum: false };
    if (first.amountMinor < spec.minDepositMinor) return { base: null, firstBeforeStart: false, belowMinimum: true };
    return { base: first, firstBeforeStart: false, belowMinimum: false };
  }
  const windowStartMs = Math.max(ms(spec.windowStart), notBefore);
  const base =
    sorted.find(
      (d) =>
        ms(d.creditedAt) >= windowStartMs &&
        ms(d.creditedAt) <= deadlineMs &&
        d.amountMinor >= spec.minDepositMinor,
    ) ?? null;
  return { base, firstBeforeStart: false, belowMinimum: false };
}

export function evaluateConditions(
  spec: ConditionSpec,
  facts: ClientFacts,
  now: Date,
  reward: {
    rewardFor: (base: DepositFact | null) => number | null;
    turnoverTarget: (rewardMinor: number | null) => number | null;
  },
): Evaluation {
  const startMs = ms(spec.windowStart);
  const deadlineMs = startMs + spec.windowDays * DAY_MS;
  const deadline = new Date(deadlineMs).toISOString();
  const nowMs = now.getTime();

  const { base, firstBeforeStart, belowMinimum } = pickBaseDeposit(facts.deposits, spec, deadlineMs);
  const rewardMinor = reward.rewardFor(base);
  const conditions: ConditionView[] = [];

  conditions.push({
    key: 'deposit',
    met: base !== null,
    current: base?.amountMinor ?? 0,
    target: spec.minDepositMinor,
  });
  if (spec.kycRequired) conditions.push({ key: 'kyc', met: facts.kycVerified });

  const target = reward.turnoverTarget(rewardMinor);
  let turnover: Evaluation['turnover'];
  if (target !== null && target > 0) {
    turnover = computeTurnover(facts.trades, {
      minHoldSeconds: spec.minHoldSeconds,
      from: spec.windowStart,
      until: deadline,
    });
    conditions.push({
      key: 'turnover',
      met: turnover.qualifyingMinor >= target,
      current: turnover.qualifyingMinor,
      target,
    });
  }

  const withdrew =
    spec.forfeitOnWithdrawal &&
    facts.withdrawals.some((w) => isLiveWithdrawal(w) && ms(w.requestedAt) >= startMs);
  if (spec.forfeitOnWithdrawal) conditions.push({ key: 'no_withdrawal', met: !withdrew });

  const allMet = conditions.every((c) => c.met);
  conditions.push({ key: 'window', met: nowMs <= deadlineMs || allMet, current: nowMs, target: deadlineMs });

  const common = { conditions, rewardMinor, baseDepositId: base?.id ?? null, windowStart: spec.windowStart, deadline, turnover };

  if (firstBeforeStart) return { ...common, state: 'not_eligible', reason: 'deposit_before_start' };
  if (belowMinimum) return { ...common, state: 'not_eligible', reason: 'below_minimum' };
  if (withdrew) return { ...common, state: 'expired', reason: 'withdrawal' };
  if (allMet && rewardMinor !== null && rewardMinor > 0) return { ...common, state: 'qualified' };
  if (nowMs > deadlineMs) return { ...common, state: 'expired', reason: 'window' };
  return { ...common, state: 'in_progress' };
}

export function evaluateDepositBonus(
  rules: DepositBonusRules,
  ctx: { enrolledAt: string; promotionStartsAt: string | null },
  facts: ClientFacts,
  now: Date,
): Evaluation {
  return evaluateConditions(
    {
      kycRequired: rules.kycRequired,
      minDepositMinor: rules.minDepositMinor,
      firstDepositOnly: rules.firstDepositOnly,
      turnoverTargetMinor: null,
      minHoldSeconds: rules.minHoldSeconds,
      windowStart: ctx.enrolledAt,
      windowDays: rules.windowDays,
      forfeitOnWithdrawal: rules.forfeitOnWithdrawal,
      depositNotBefore: ctx.promotionStartsAt,
    },
    facts,
    now,
    {
      rewardFor: (base) =>
        base ? Math.min(rules.capMinor, Math.floor((base.amountMinor * rules.percentBps) / 10_000)) : null,
      turnoverTarget: (reward) =>
        rules.turnoverMultiplier > 0
          ? reward === null
            ?
              Math.ceil(rules.capMinor * rules.turnoverMultiplier)
            : Math.ceil(reward * rules.turnoverMultiplier)
          : null,
    },
  );
}

export function evaluateReferee(
  rules: ReferralRules | IbCpaRules,
  ctx: { attributedAt: string; rewardMinor: number },
  facts: ClientFacts,
  now: Date,
): Evaluation {
  return evaluateConditions(
    {
      kycRequired: rules.kycRequired,
      minDepositMinor: rules.minDepositMinor,
      firstDepositOnly: false,
      turnoverTargetMinor: rules.turnoverNotionalMinor,
      minHoldSeconds: rules.minHoldSeconds,
      windowStart: ctx.attributedAt,
      windowDays: rules.windowDays,
      forfeitOnWithdrawal: 'forfeitOnWithdrawal' in rules ? rules.forfeitOnWithdrawal : false,
      depositNotBefore: null,
    },
    facts,
    now,
    {
      rewardFor: (base) => (base ? ctx.rewardMinor : null),
      turnoverTarget: () => (rules.turnoverNotionalMinor > 0 ? rules.turnoverNotionalMinor : null),
    },
  );
}

export function periodOf(at: Date | string): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function periodBounds(period: string): { from: string; until: string } {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const from = new Date(Date.UTC(y, m - 1, 1));
  const until = new Date(Date.UTC(y, m, 1) - 1);
  return { from: from.toISOString(), until: until.toISOString() };
}

export function isPeriod(v: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

export interface CashbackResult {
  period: string;
  feesMinor: number;
  tradesWithoutFees: number;
  cashbackMinor: number;
  belowMinimum: boolean;
}

export function computeCashback(
  rules: CashbackRules,
  trades: readonly { executedAt: string; commissionMinor?: number | null; markupMinor?: number | null }[],
  period: string,
): CashbackResult {
  const { from, until } = periodBounds(period);
  const fromMs = ms(from);
  const untilMs = ms(until);
  let fees = 0;
  let without = 0;
  for (const t of trades) {
    const at = ms(t.executedAt);
    if (at < fromMs || at > untilMs) continue;
    const c = Number.isFinite(t.commissionMinor as number) ? Math.max(0, Number(t.commissionMinor)) : null;
    const m = Number.isFinite(t.markupMinor as number) ? Math.max(0, Number(t.markupMinor)) : null;
    if (c === null && m === null) without += 1;
    fees += (c ?? 0) + (m ?? 0);
  }
  let cashback = Math.floor((fees * rules.percentBps) / 10_000);
  if (rules.capPerPeriodMinor > 0) cashback = Math.min(cashback, rules.capPerPeriodMinor);
  const belowMinimum = cashback < rules.minPayoutMinor || cashback === 0;
  return {
    period,
    feesMinor: fees,
    tradesWithoutFees: without,
    cashbackMinor: belowMinimum ? 0 : cashback,
    belowMinimum,
  };
}

export function platformRevenueMinor(
  trades: readonly { executedAt: string; commissionMinor?: number | null; markupMinor?: number | null }[],
  period: string,
): number {
  const { from, until } = periodBounds(period);
  let sum = 0;
  for (const t of trades) {
    const at = ms(t.executedAt);
    if (at < ms(from) || at > ms(until)) continue;
    const c = typeof t.commissionMinor === 'number' && Number.isFinite(t.commissionMinor) ? Math.max(0, t.commissionMinor) : null;
    const m = typeof t.markupMinor === 'number' && Number.isFinite(t.markupMinor) ? Math.max(0, t.markupMinor) : null;
    if (c !== null) sum += c;
    if (m !== null) sum += m;
  }
  return sum;
}

export function revshareMinor(revenueMinor: number, bps: number): number {
  return Math.floor((Math.max(0, revenueMinor) * bps) / 10_000);
}

export interface PromotionContext {
  startsAt: string | null;
  endsAt: string | null;
}

export function evaluatePromotion(
  parsed: ParsedRules,
  promo: PromotionContext,
  participation: { enrolledAt: string },
  facts: ClientFacts,
  now: Date,
): Evaluation | CashbackResult | null {
  switch (parsed.type) {
    case 'deposit_bonus':
      return evaluateDepositBonus(
        parsed.rules,
        { enrolledAt: participation.enrolledAt, promotionStartsAt: promo.startsAt },
        facts,
        now,
      );
    case 'cashback':
      return computeCashback(
        parsed.rules,
        facts.trades.filter((t) => ms(t.executedAt) >= ms(participation.enrolledAt)),
        periodOf(now),
      );
    default:
      return null;
  }
}
