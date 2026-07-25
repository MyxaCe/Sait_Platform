'use client';

import { useTranslations } from 'next-intl';
import { DEFAULT_TICKER_SYMBOLS, useConnectionStatus, useRealtimeQuotes } from '@broker/realtime';
import { TickerTape } from '@broker/ui';
import { formatPrice } from '@broker/utils';

/** Живые котировки в дашборде — тот же FeedDriver, что на сайте. */
export function CabinetTicker() {
  const tConn = useTranslations('connection');
  const quotes = useRealtimeQuotes(DEFAULT_TICKER_SYMBOLS.slice(0, 8));
  const status = useConnectionStatus();

  const items = quotes.map((q) => ({
    symbol: q.symbol,
    price: formatPrice(q.price, q.digits),
    changePercent: q.changePercent,
  }));

  return (
    <TickerTape
      items={items}
      status={status}
      ariaLabel={tConn('tickerAria')}
      connectionLabel={tConn(status)}
    />
  );
}
