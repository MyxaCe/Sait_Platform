'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useConnectionStatus, useRealtimeQuotes, type QuoteMarket } from '@broker/realtime';
import { Button, ConnectionDot, PriceChange, cn } from '@broker/ui';
import { formatPrice } from '@broker/utils';
import { useMarketText } from '../quotes/market-text';
import { explainUnavailable } from '../quotes/unavailable-text';
import { QuotePrice, priceReading } from './QuotePrice';
import { usePriceFlash } from './usePriceFlash';

export interface LiveQuotePanelProps {
  symbol: string;
  unavailableReason?: string;
  market?: QuoteMarket | null;
  tradeHref: string;
  demoHref: string;
}

export function LiveQuotePanel({ symbol, unavailableReason, market = null, tradeHref, demoHref }: LiveQuotePanelProps) {
  const t = useTranslations('instruments');
  const tConn = useTranslations('connection');
  const tWhy = useTranslations('instrumentUnavailable');
  const [quote] = useRealtimeQuotes([symbol]);
  const status = useConnectionStatus();
  const [openedAt] = useState(() => Date.now());

  const reading = priceReading(quote);
  const flash = usePriceFlash(reading);

  const marketText = useMarketText();
  const tickedSinceOpen = quote !== undefined && reading !== null && quote.ts >= openedAt;
  const why = unavailableReason === undefined ? null : explainUnavailable(unavailableReason);
  const serverMarket: QuoteMarket | null =
    market ??
    (why?.family === 'market'
      ? { status: unavailableReason === 'market-halted' ? 'halted' : 'closed', reason: null, nextOpen: null }
      : null);
  const marketNote = marketText(quote?.market ?? (tickedSinceOpen ? null : serverMarket));
  const whyText = why && why.family !== 'market' && reading === null ? tWhy(why.key) : null;
  const note = marketNote ?? whyText;
  const showWhy = note !== null;
  const noPriceText = note ?? tConn('noData');

  const side = (value: number | null | undefined) =>
    reading !== null && quote && typeof value === 'number' ? formatPrice(value, quote.digits) : null;
  const bid = side(quote?.bid);
  const ask = side(quote?.ask);

  const statusText =
    status === 'connected' ? t('panelLive') : status === 'simulated' ? tConn('simulated') : t('panelConnecting');

  return (
    <div className="rounded-3xl border border-border bg-card p-6 sm:p-8" data-testid="quote-panel">
      <div className="flex items-center gap-2 text-xs text-secondary">
        <ConnectionDot status={status} label={tConn(status)} />
        {statusText}
      </div>

      <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <span
          data-testid="quote-price"
          className={cn(
            'text-4xl font-semibold tabular-nums tracking-tight text-primary transition-colors duration-500 sm:text-5xl',
            flash === 'up' && 'text-positive',
            flash === 'down' && 'text-negative',
          )}
        >
          <QuotePrice quote={quote} noDataLabel={noPriceText} />
        </span>
        <PriceChange value={reading === null ? null : (quote?.changePercent ?? null)} className="text-base" />
      </div>

      {(showWhy || reading === null) && (
        <p
          className={cn('mt-2 text-sm', marketNote ? 'text-primary' : 'text-secondary')}
          data-testid="quote-unavailable"
          data-reason={showWhy ? (unavailableReason ?? (marketNote ? `market-${quote?.market?.status ?? serverMarket?.status}` : undefined)) : undefined}
        >
          {noPriceText}
        </p>
      )}

      <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-border pt-6 text-sm">
        <div>
          <dt className="text-secondary">Bid</dt>
          <dd className="mt-1 tabular-nums text-negative" data-testid="quote-bid">
            {bid ?? <span className="text-secondary" title={tConn('noData')}>—</span>}
          </dd>
        </div>
        <div>
          <dt className="text-secondary">Ask</dt>
          <dd className="mt-1 tabular-nums text-positive" data-testid="quote-ask">
            {ask ?? <span className="text-secondary" title={tConn('noData')}>—</span>}
          </dd>
        </div>
      </dl>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <a href={tradeHref} className="w-full sm:flex-1" data-testid="trade-real">
          <Button size="lg" className="w-full" tabIndex={-1}>
            {t('tradeSymbol', { symbol })}
          </Button>
        </a>
        <a href={demoHref} className="w-full sm:flex-1" data-testid="trade-demo">
          <Button variant="secondary" size="lg" className="w-full" tabIndex={-1}>
            {t('tryOnDemo')}
          </Button>
        </a>
      </div>
    </div>
  );
}
