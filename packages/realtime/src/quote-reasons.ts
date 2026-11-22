import type { Quote, QuoteMarket } from './types';

export const SYMBOL_UNAVAILABLE_REASONS = [
  'registry-unreadable',
  'no-source',
  'source-disabled',
  'source-silent',
  'stale',
  'not-in-catalog',
  'threshold-unset',
  'market-closed',
  'market-halted',
] as const;

export type SymbolUnavailableReason = (typeof SYMBOL_UNAVAILABLE_REASONS)[number];

const KNOWN: ReadonlySet<string> = new Set(SYMBOL_UNAVAILABLE_REASONS);

export function isSymbolUnavailableReason(value: unknown): value is SymbolUnavailableReason {
  return typeof value === 'string' && KNOWN.has(value);
}

export interface SymbolUnavailable {
  symbol: string;
  reason: SymbolUnavailableReason | null;
  rawReason?: string;
  nextOpen?: number | null;
}

export interface QuotesState {
  unavailable: SymbolUnavailable[];
  missing: string[];
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((i): i is Record<string, unknown> => isObject(i)) : [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseQuotesState(body: unknown): QuotesState {
  const root = isObject(body) ? body : {};

  const unavailable: SymbolUnavailable[] = [];
  for (const item of asRecordArray(root.unavailable)) {
    const symbol = item.symbol;
    if (typeof symbol !== 'string' || symbol.length === 0) continue;

    const reason = item.reason;
    if (reason === 'market-closed' || reason === 'market-halted') {
      unavailable.push({ symbol, reason, nextOpen: parseNextOpen(item.nextOpen) });
    } else if (isSymbolUnavailableReason(reason)) {
      unavailable.push({ symbol, reason });
    } else {
      unavailable.push({
        symbol,
        reason: null,
        rawReason: typeof reason === 'string' ? reason : String(reason),
      });
    }
  }

  const missing = Array.isArray(root.missing)
    ? root.missing.filter((s): s is string => typeof s === 'string' && s.length > 0)
    : [];

  return { unavailable, missing };
}

export function parseNextOpen(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function marketsOf(state: QuotesState): Map<string, QuoteMarket> {
  const out = new Map<string, QuoteMarket>();
  for (const u of state.unavailable) {
    if (u.reason === 'market-closed') out.set(u.symbol, { status: 'closed', reason: null, nextOpen: u.nextOpen ?? null });
    if (u.reason === 'market-halted') out.set(u.symbol, { status: 'halted', reason: null, nextOpen: u.nextOpen ?? null });
  }
  return out;
}

export function pausedMarket(market: QuoteMarket | null | undefined): QuoteMarket | null {
  return market && market.status !== 'open' ? market : null;
}

export function formatNextOpen(nextOpen: number, locale: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(nextOpen));
}

export function staleSymbolsOf(state: QuotesState): ReadonlySet<string> {
  return new Set([...state.unavailable.map((u) => u.symbol), ...state.missing]);
}

export function displayPrice(
  quote: Pick<Quote, 'price' | 'digits' | 'ts'>,
  format: (price: number, digits: number) => string,
): string | null {
  if (quote.ts === 0) return null;
  return format(quote.price, quote.digits);
}
