import { ConnectionDot, type ConnectionState } from '../../atoms/ConnectionDot/ConnectionDot';
import { PriceChange } from '../../atoms/PriceChange/PriceChange';
import { cn } from '../../lib/cn';

export type QuoteDisplayState = 'live' | 'simulated' | 'unavailable' | 'closed' | 'halted';

export interface TickerItem {
  symbol: string;
  price: string | null;
  changePercent: number | null;
  href?: string;
  state?: QuoteDisplayState;
  unavailableLabel?: string;
  unavailableShort?: string;
  marketLabel?: string;
}

export interface TickerTapeProps {
  items: TickerItem[];
  status?: ConnectionState;
  ariaLabel?: string;
  connectionLabel?: string;
  noDataLabel?: string;
  lastKnownLabel?: string;
  className?: string;
}

export function TickerTape({
  items,
  status = 'connected',
  ariaLabel = 'Котировки в реальном времени',
  connectionLabel,
  noDataLabel = 'нет данных',
  lastKnownLabel = 'последняя известная',
  className,
}: TickerTapeProps) {
  if (items.length === 0) return null;

  const simulated = status === 'simulated';

  const renderItems = (ariaHidden: boolean) =>
    items.map((item) => {
      const unavailable = item.state === 'unavailable';
      const paused = (item.state === 'closed' || item.state === 'halted') && item.price !== null;
      const content = paused ? (
        <>
          <span className="font-medium text-primary">{item.symbol}</span>
          <span className="tabular-nums text-secondary">{item.price}</span>
          <span className="text-[11px] uppercase tracking-wide text-secondary" data-market={item.state}>
            {item.marketLabel ?? item.unavailableShort ?? lastKnownLabel}
          </span>
        </>
      ) : unavailable || item.state === 'closed' || item.state === 'halted' ? (
        <>
          <span className="font-medium text-primary">{item.symbol}</span>
          {item.price === null ? (
            <>
              <span
                className="tabular-nums text-secondary"
                title={item.unavailableLabel ?? noDataLabel}
              >
                —
              </span>
              <span className="text-[11px] uppercase tracking-wide text-secondary">
                {item.unavailableShort ?? noDataLabel}
              </span>
            </>
          ) : (
            <>
              <span
                className="tabular-nums text-secondary opacity-50"
                title={item.unavailableLabel ?? lastKnownLabel}
              >
                {item.price}
              </span>
              <span className="text-[11px] uppercase tracking-wide text-secondary">
                {item.unavailableShort ?? lastKnownLabel}
              </span>
            </>
          )}
        </>
      ) : (
        <>
          <span className="font-medium text-primary">{item.symbol}</span>
          <span className="tabular-nums text-secondary">{item.price ?? '—'}</span>
          <PriceChange value={item.changePercent} noDataLabel={noDataLabel} />
        </>
      );
      const itemClass = 'flex shrink-0 items-center gap-2 text-sm';
      return item.href && !ariaHidden ? (
        <a key={item.symbol} href={item.href} className={cn(itemClass, 'hover:opacity-80')}>
          {content}
        </a>
      ) : (
        <span key={item.symbol} className={itemClass} aria-hidden={ariaHidden}>
          {content}
        </span>
      );
    });

  return (
    <div className={cn('border-b border-border bg-elevated', className)} aria-label={ariaLabel}>
      {simulated && (
        <div className="flex items-center gap-2 border-b border-border bg-secondary/10 px-3 py-1">
          <ConnectionDot status={status} label={connectionLabel} />
          <span className="text-[11px] font-medium uppercase tracking-wide text-secondary">
            {connectionLabel ?? 'Демо-данные: цены не рыночные'}
          </span>
        </div>
      )}

      <div className="relative overflow-hidden">
        {!simulated && (
          <div className="absolute left-3 top-1/2 z-20 -translate-y-1/2">
            <ConnectionDot status={status} label={connectionLabel} />
          </div>
        )}

        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-gradient-to-r from-elevated to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l from-elevated to-transparent" />

        <div
          className={cn(
            'flex w-max animate-ticker gap-8 py-2.5 pr-8 hover:[animation-play-state:paused] motion-reduce:animate-none',
            simulated ? 'pl-4' : 'pl-10',
          )}
        >
          {renderItems(false)}
          {renderItems(true)}
        </div>
      </div>
    </div>
  );
}
