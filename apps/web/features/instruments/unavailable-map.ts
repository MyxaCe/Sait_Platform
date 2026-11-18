import { staleSymbolsOf, type QuotesState } from '@broker/realtime';
import type { MdsQuotesOutcome } from '@/lib/mds';

export function unavailableReasonsOf(outcome: MdsQuotesOutcome): Record<string, string> {
  if (outcome.state !== 'available') {
    return {};
  }

  return reasonsFromState(outcome.quotes);
}

export function reasonsFromState(state: QuotesState): Record<string, string> {
  const out: Record<string, string> = {};

  for (const u of state.unavailable) {
    if (u.symbol.length === 0) continue;
    out[u.symbol] = u.reason ?? u.rawReason ?? '';
  }

  for (const symbol of state.missing) {
    if (symbol.length > 0 && out[symbol] === undefined) out[symbol] = 'missing';
  }

  return out;
}

export function agreesWithStaleSymbols(state: QuotesState): boolean {
  const mine = new Set(Object.keys(reasonsFromState(state)));
  const theirs = staleSymbolsOf(state);

  if (mine.size !== theirs.size) return false;
  for (const symbol of mine) if (!theirs.has(symbol)) return false;
  return true;
}
