import { isLeverageClass } from '@broker/money/leverage-classes';
import { DEPOSIT_METHODS, depositMethodLabel } from './deposit-methods';
import { formatAmount, formatBpsPercent, formatLeverage, formatList, formatSupportHours, type LiveLabels } from './format';
import { portfolioLeverage, publicPortfolios, type LiveSnapshot } from './snapshot';

export const MISSING_VALUE = '—';

export const SETTLEMENT_CURRENCY = 'USDT';
export const DEMO_CURRENCY = 'USD';

export const LIVE_PARAMS = [
  'deposit.min',
  'withdraw.min',
  'withdraw.unverifiedPercent',
  'deposit.methods',
  'demo.startBalance',
  'leverage.max',
  'leverage.<class>',
  'account.<key>.name',
  'account.<key>.leverage',
  'account.<key>.leverage.<class>',
  'account.<key>.commission',
  'account.<key>.markup',
  'support.hours',
] as const;

export type LiveSource = 'snapshot' | 'startBalance' | 'labels';

export interface ParamContext {
  locale: string;
  snapshot: LiveSnapshot | null;
  startBalanceCents: number | null;
  labels: LiveLabels | null;
}

export type ParamOutcome = { ok: true; value: string } | { ok: false; reason: 'unknown' | 'unavailable' };

const ACCOUNT = /^account\.([a-z0-9_-]+)\.(name|leverage|commission|markup)(?:\.([a-z0-9_-]+))?$/;
const CLASS_LEVERAGE = /^leverage\.([a-z]+)$/;

function leverageClassOf(name: string): string | null {
  const m = CLASS_LEVERAGE.exec(name);
  return m && isLeverageClass(m[1]!) ? m[1]! : null;
}

export function sourcesOf(name: string): LiveSource[] | null {
  switch (name) {
    case 'deposit.min':
    case 'withdraw.min':
    case 'withdraw.unverifiedPercent':
    case 'leverage.max':
      return ['snapshot'];
    case 'deposit.methods':
      return [];
    case 'demo.startBalance':
      return ['startBalance'];
    case 'support.hours':
      return ['snapshot', 'labels'];
  }
  if (leverageClassOf(name)) return ['snapshot'];
  const m = ACCOUNT.exec(name);
  if (!m) return null;
  if (m[3] !== undefined && m[2] !== 'leverage') return null;
  return ['snapshot'];
}

const ok = (value: string): ParamOutcome => ({ ok: true, value });
const UNAVAILABLE: ParamOutcome = { ok: false, reason: 'unavailable' };
const UNKNOWN: ParamOutcome = { ok: false, reason: 'unknown' };

export function resolveParam(name: string, ctx: ParamContext): ParamOutcome {
  if (sourcesOf(name) === null) return UNKNOWN;
  const { locale, snapshot } = ctx;
  switch (name) {
    case 'deposit.min':
      return snapshot?.money ? ok(formatAmount(snapshot.money.minDepositMinor, SETTLEMENT_CURRENCY, locale)) : UNAVAILABLE;
    case 'withdraw.min':
      return snapshot?.money ? ok(formatAmount(snapshot.money.minWithdrawMinor, SETTLEMENT_CURRENCY, locale)) : UNAVAILABLE;
    case 'withdraw.unverifiedPercent':
      return snapshot?.money ? ok(formatBpsPercent(snapshot.money.unverifiedWithdrawBps, locale)) : UNAVAILABLE;
    case 'deposit.methods':
      return DEPOSIT_METHODS.length > 0 ? ok(formatList(DEPOSIT_METHODS.map(depositMethodLabel), locale)) : UNAVAILABLE;
    case 'demo.startBalance':
      return ctx.startBalanceCents === null ? UNAVAILABLE : ok(formatAmount(ctx.startBalanceCents, DEMO_CURRENCY, locale));
    case 'leverage.max': {
      const list = publicPortfolios(snapshot);
      if (!list || list.length === 0) return UNAVAILABLE;
      return ok(formatLeverage(Math.max(...list.map((p) => p.baseLeverage))));
    }
    case 'support.hours': {
      if (!snapshot?.support) return UNAVAILABLE;
      const value = formatSupportHours(snapshot.support, locale, ctx.labels);
      return value ? ok(value) : UNAVAILABLE;
    }
  }
  const cls = leverageClassOf(name);
  if (cls) {
    const list = publicPortfolios(snapshot);
    if (!list || list.length === 0) return UNAVAILABLE;
    return ok(formatLeverage(Math.max(...list.map((p) => portfolioLeverage(p, cls)))));
  }
  const m = ACCOUNT.exec(name)!;
  const [, key, field, instrumentClass] = m;
  const list = publicPortfolios(snapshot);
  if (!list) return UNAVAILABLE;
  const portfolio = list.find((p) => p.key === key);
  if (!portfolio) return UNKNOWN;
  switch (field) {
    case 'name':
      return ok(portfolio.title);
    case 'leverage':
      return ok(formatLeverage(portfolioLeverage(portfolio, instrumentClass ?? null)));
    case 'commission':
      return ok(formatBpsPercent(portfolio.commissionBps, locale));
    default:
      return ok(formatBpsPercent(portfolio.markupBps, locale));
  }
}
