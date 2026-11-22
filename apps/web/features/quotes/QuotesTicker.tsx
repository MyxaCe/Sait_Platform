'use client';

import { useTranslations } from 'next-intl';
import { displayPrice, useConnectionStatus, useQuoteViews, type QuoteMarket } from '@broker/realtime';
import { TickerTape } from '@broker/ui';
import { formatPrice } from '@broker/utils';
import { useMarketText } from './market-text';
import { explainUnavailable, shortKeyOf } from './unavailable-text';

export function QuotesTicker({
  symbols,
  staleSymbols,
  unavailableReasons,
  markets,
}: {
  symbols: string[];
  staleSymbols?: ReadonlySet<string>;
  unavailableReasons?: ReadonlyMap<string, string | null>;
  markets?: ReadonlyMap<string, QuoteMarket>;
}) {
  const tConn = useTranslations('connection');
  const tWhy = useTranslations('instrumentUnavailable');
  const views = useQuoteViews(symbols, { staleSymbols, markets });
  const marketText = useMarketText();
  const status = useConnectionStatus();

  const items = views.map(({ quote: q, state }) => {
    const reason = unavailableReasons?.get(q.symbol);
    const why = reason === undefined ? null : explainUnavailable(reason);
    const market = marketText(q.market ?? markets?.get(q.symbol));
    return {
      symbol: q.symbol,
      price: displayPrice(q, formatPrice),
      changePercent: q.changePercent,
      href: `/instruments/${q.category}/${q.symbol.toLowerCase()}`,
      state,
      unavailableLabel: why ? tWhy(why.key) : undefined,
      unavailableShort: market ?? (why ? tWhy(shortKeyOf(why)) : undefined),
      marketLabel: market ?? undefined,
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
