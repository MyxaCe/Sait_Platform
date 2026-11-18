'use client';

import { useTranslations } from 'next-intl';
import { displayPrice, useConnectionStatus, useQuoteViews } from '@broker/realtime';
import { TickerTape } from '@broker/ui';
import { formatPrice } from '@broker/utils';
import { explainUnavailable } from './unavailable-text';

export function QuotesTicker({
  symbols,
  staleSymbols,
  unavailableReasons,
}: {
  symbols: string[];
  staleSymbols?: ReadonlySet<string>;
  unavailableReasons?: ReadonlyMap<string, string | null>;
}) {
  const tConn = useTranslations('connection');
  const tWhy = useTranslations('instrumentUnavailable');
  const views = useQuoteViews(symbols, { staleSymbols });
  const status = useConnectionStatus();

  const items = views.map(({ quote: q, state }) => {
    const reason = unavailableReasons?.get(q.symbol);
    const why = reason === undefined ? null : explainUnavailable(reason);
    return {
      symbol: q.symbol,
      price: displayPrice(q, formatPrice),
      changePercent: q.changePercent,
      href: `/instruments/${q.category}/${q.symbol.toLowerCase()}`,
      state,
      unavailableLabel: why ? tWhy(why.key) : undefined,
      unavailableShort: why ? tWhy(why.family === 'limited' ? 'shortLimited' : 'shortFault') : undefined,
    };
  });

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
