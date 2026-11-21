'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatNextOpen, pausedMarket, type QuoteMarket } from '@broker/realtime';
import { intlTag } from '@broker/utils/locales';

export function useMarketText(): (market: QuoteMarket | null | undefined) => string | null {
  const t = useTranslations('instrumentUnavailable');
  const locale = useLocale();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return useCallback(
    (market) => {
      const paused = pausedMarket(market);
      if (!paused) return null;
      if (paused.status === 'halted') return t('marketHalted');
      if (paused.nextOpen !== null && mounted) {
        return t('marketClosedUntil', { time: formatNextOpen(paused.nextOpen, intlTag(locale)) });
      }
      return t('marketClosed');
    },
    [t, locale, mounted],
  );
}
