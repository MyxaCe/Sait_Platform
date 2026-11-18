import type { ConnStatus, Quote } from './types';

export type QuoteState = 'live' | 'simulated' | 'unavailable';

export interface FreshnessInput {
  feedStatus: ConnStatus;
  staleSymbols?: ReadonlySet<string>;
  staleAfterMs?: number;
  now?: number;
}

export function quoteState(quote: Quote | undefined, input: FreshnessInput): QuoteState {
  const { feedStatus, staleSymbols, staleAfterMs, now = Date.now() } = input;

  if (feedStatus === 'simulated') return 'simulated';

  if (!quote) return 'unavailable';

  if (quote.ts === 0) return 'unavailable';

  if (staleSymbols?.has(quote.symbol)) return 'unavailable';

  if (feedStatus === 'offline') return 'unavailable';

  if (staleAfterMs !== undefined && now - quote.ts > staleAfterMs) return 'unavailable';

  return 'live';
}
