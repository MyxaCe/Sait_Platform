'use client';

import { useTranslations } from 'next-intl';
import {
  DEFAULT_TICKER_SYMBOLS,
  displayPrice,
  useConnectionStatus,
  useQuoteViews,
} from '@broker/realtime';
import { TickerTape } from '@broker/ui';
import { formatPrice } from '@broker/utils';

/** Живые котировки в дашборде — тот же FeedDriver, что на сайте. */
export function CabinetTicker() {
  const tConn = useTranslations('connection');
  const views = useQuoteViews(DEFAULT_TICKER_SYMBOLS.slice(0, 8));
  const status = useConnectionStatus();

  const items = views.map(({ quote: q, state }) => ({
    symbol: q.symbol,
    // То же правило, что у витрины, и ровно поэтому оно в пакете (PKG-06).
    price: displayPrice(q, formatPrice),
    changePercent: q.changePercent,
    state,
  }));

  return (
    <TickerTape
      items={items}
      status={status}
      ariaLabel={tConn('tickerAria')}
      connectionLabel={tConn(status)}
      noDataLabel={tConn('noData')}
      lastKnownLabel={tConn('lastKnown')}
    />
  );
}
