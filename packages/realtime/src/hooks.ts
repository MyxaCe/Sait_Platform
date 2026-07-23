'use client';

import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { realtime } from './service';
import { useQuotesStore } from './store';
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
