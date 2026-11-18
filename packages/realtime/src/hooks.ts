'use client';

import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { realtime } from './service';
import { useQuotesStore } from './store';
import { quoteState, type QuoteState } from './freshness';
import type { ConnStatus, Quote } from './types';

export function useRealtimeQuotes(symbols: string[]): Quote[] {
  const key = symbols.join(',');

  useEffect(() => {
    realtime.connect();
    return realtime.subscribe(symbols);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return useQuotesStore(
    useShallow((state) =>
      symbols.map((s) => state.quotes[s]).filter((q): q is Quote => q !== undefined),
    ),
  );
}

export function useConnectionStatus(): ConnStatus {
  return useQuotesStore((state) => state.status);
}

export interface QuoteView {
  quote: Quote;
  state: QuoteState;
}

export interface QuoteViewOptions {
  staleAfterMs?: number;
  staleSymbols?: ReadonlySet<string>;
}

export function useQuoteViews(symbols: string[], options: QuoteViewOptions = {}): QuoteView[] {
  const quotes = useRealtimeQuotes(symbols);
  const feedStatus = useConnectionStatus();
  const { staleAfterMs, staleSymbols } = options;
  return quotes.map((quote) => ({
    quote,
    state: quoteState(quote, { feedStatus, staleAfterMs, staleSymbols }),
  }));
}
