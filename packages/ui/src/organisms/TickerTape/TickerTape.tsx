import { ConnectionDot, type ConnectionState } from '../../atoms/ConnectionDot/ConnectionDot';
import { PriceChange } from '../../atoms/PriceChange/PriceChange';
import { cn } from '../../lib/cn';

export interface TickerItem {
  symbol: string;
  /** Уже отформатированная цена — форматирование остаётся за приложением */
  price: string;
  changePercent: number;
  href?: string;
}

export interface TickerTapeProps {
  items: TickerItem[];
  status?: ConnectionState;
  /** Локализованный aria-label ленты */
  ariaLabel?: string;
  /** Локализованная подпись индикатора соединения */
  connectionLabel?: string;
  className?: string;
}

/**
 * Бегущая строка котировок. Чисто презентационный компонент —
 * источник данных (WebSocket-стор) подключает приложение.
 * Анимация — CSS (не грузит main thread), пауза на hover,
 * отключается при prefers-reduced-motion.
 */
export function TickerTape({
  items,
  status = 'connected',
  ariaLabel = 'Котировки в реальном времени',
  connectionLabel,
  className,
}: TickerTapeProps) {
  if (items.length === 0) return null;

  const renderItems = (ariaHidden: boolean) =>
    items.map((item) => {
      const content = (
        <>
          <span className="font-medium text-primary">{item.symbol}</span>
          <span className="tabular-nums text-secondary">{item.price}</span>
          <PriceChange value={item.changePercent} />
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
    <div
      className={cn('relative overflow-hidden border-b border-border bg-elevated', className)}
      aria-label={ariaLabel}
    >
      <div className="absolute left-3 top-1/2 z-20 -translate-y-1/2">
        <ConnectionDot status={status} label={connectionLabel} />
      </div>

      {/* Затемнение краёв, чтобы элементы «выплывали» мягко */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-gradient-to-r from-elevated to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l from-elevated to-transparent" />

      {/* Список дублируется для бесшовного цикла: анимация сдвигает ровно на 50% */}
      <div className="flex w-max animate-ticker gap-8 py-2.5 pl-10 pr-8 hover:[animation-play-state:paused] motion-reduce:animate-none">
        {renderItems(false)}
        {renderItems(true)}
      </div>
    </div>
  );
}
