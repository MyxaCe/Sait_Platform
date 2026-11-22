import { pausedMarket } from './quote-reasons';
import type { ConnStatus, Quote, QuoteMarket } from './types';

export type QuoteState = 'live' | 'simulated' | 'unavailable' | 'closed' | 'halted';

export interface FreshnessInput {
  feedStatus: ConnStatus;
  staleSymbols?: ReadonlySet<string>;
  markets?: ReadonlyMap<string, QuoteMarket>;
  staleAfterMs?: number;
  now?: number;
}

export function quoteState(quote: Quote | undefined, input: FreshnessInput): QuoteState {
  const { feedStatus, staleSymbols, markets, staleAfterMs, now = Date.now() } = input;

  if (feedStatus === 'simulated') return 'simulated';

  if (!quote) return 'unavailable';

  if (quote.ts === 0) return 'unavailable';

  const market = pausedMarket(quote.market ?? markets?.get(quote.symbol));
  if (market && feedStatus !== 'offline') return market.status === 'halted' ? 'halted' : 'closed';

  if (staleSymbols?.has(quote.symbol)) return 'unavailable';

  if (feedStatus === 'offline') return 'unavailable';

  if (staleAfterMs !== undefined && now - quote.ts > staleAfterMs) return 'unavailable';

  return 'live';
}
