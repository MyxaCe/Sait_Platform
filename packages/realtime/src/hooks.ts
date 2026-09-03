'use client';

import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { realtime } from './service';
import { useQuotesStore } from './store';
import { quoteState, type QuoteState } from './freshness';
import type { ConnStatus, Quote } from './types';

/**
 * Подписка на живые котировки. Автоматически подключает фид,
 * подписывается на символы и отписывается при размонтировании.
 * До первого тика возвращает статичный снапшот из стора (SSR-безопасно).
 */
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

/**
 * Котировки вместе с вердиктом «что это за цифра» (live / simulated /
 * unavailable). Отдельный хук, а не поле в Quote: Quote — то, что пришло от
 * источника, а вердикт зависит ещё и от состояния фида и от порога свежести.
 *
 * `staleAfterMs` приходит от приложения и намеренно не имеет умолчания —
 * порог принадлежит источнику (MDS), выдуманный здесь начнёт молча
 * расходиться с тем, по которому источник считает сам.
 *
 * Сознательно НЕ сделано: приём списка протухших символов от MDS — формат
 * ответа ещё не согласован (КОНТРАКТЫ.md §5б). Место под него есть
 * (staleSymbols в quoteState), проводки нет.
 */
export function useQuoteViews(symbols: string[], staleAfterMs?: number): QuoteView[] {
  const quotes = useRealtimeQuotes(symbols);
  const feedStatus = useConnectionStatus();
  return quotes.map((quote) => ({
    quote,
    state: quoteState(quote, { feedStatus, staleAfterMs }),
  }));
}
