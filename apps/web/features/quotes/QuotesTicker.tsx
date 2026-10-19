'use client';

import { useTranslations } from 'next-intl';
import { useConnectionStatus, useQuoteViews } from '@broker/realtime';
import { TickerTape } from '@broker/ui';
import { formatPrice } from '@broker/utils';

/**
 * Контейнер бегущей строки: подписывается на живой фид
 * (мок или socket.io — решает NEXT_PUBLIC_WS_URL) и маппит
 * котировки в презентационный TickerTape из дизайн-системы.
 *
 * `symbols` ОБЯЗАТЕЛЕН и умолчания не имеет (WEB-08, Р-050). Здесь стоял
 * `= DEFAULT_TICKER_SYMBOLS`, и это была вторая дверь к тому же дефекту:
 * `<QuotesTicker />` без пропа рисовал зашитый список как живые
 * котировки. Решение, какие символы показывать, принимает `decideTicker`
 * по рантайм-ответам; компонент его не угадывает.
 */
export function QuotesTicker({ symbols }: { symbols: string[] }) {
  const tConn = useTranslations('connection');
  // Порог свежести придёт от MDS (КОНТРАКТЫ.md §5б) — здесь не выдумываем
  const views = useQuoteViews(symbols);
  const status = useConnectionStatus();

  const items = views.map(({ quote: q, state }) => ({
    symbol: q.symbol,
    price: formatPrice(q.price, q.digits),
    changePercent: q.changePercent,
    href: `/instruments/${q.category}/${q.symbol.toLowerCase()}`,
    state,
  }));

  return (
    <TickerTape
      items={items}
      status={status}
      ariaLabel={tConn('tickerAria')}
      connectionLabel={tConn(status)}
      noDataLabel={tConn('noData')}
    />
  );
}
