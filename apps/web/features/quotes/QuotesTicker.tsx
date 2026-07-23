'use client';

import { useTranslations } from 'next-intl';
import {
  DEFAULT_TICKER_SYMBOLS,
  useConnectionStatus,
  useRealtimeQuotes,
} from '@broker/realtime';
import { TickerTape } from '@broker/ui';
import { formatPrice } from '@broker/utils';

/**
 * Контейнер бегущей строки: подписывается на живой фид
 * (мок или socket.io — решает NEXT_PUBLIC_WS_URL) и маппит
 * котировки в презентационный TickerTape из дизайн-системы.
 */
export function QuotesTicker() {
  const tConn = useTranslations('connection');
  const quotes = useRealtimeQuotes(DEFAULT_TICKER_SYMBOLS);
  const status = useConnectionStatus();

  const items = quotes.map((q) => ({
    symbol: q.symbol,
    price: formatPrice(q.price, q.digits),
    changePercent: q.changePercent,
    href: `/instruments/${q.category}/${q.symbol.toLowerCase()}`,
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
