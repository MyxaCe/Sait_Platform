import { ConnectionDot, type ConnectionState } from '../../atoms/ConnectionDot/ConnectionDot';
import { PriceChange } from '../../atoms/PriceChange/PriceChange';
import { cn } from '../../lib/cn';

/**
 * Что за цифра стоит на месте цены. `unavailable` — данных нет: показывать
 * вместо них последнюю известную цену нельзя, она неотличима от текущей и
 * читается как «рынок стоит» (правило про отказ, выглядящий правдоподобным
 * значением). Дублирует QuoteState из @broker/realtime намеренно:
 * дизайн-система не зависит от источника данных.
 */
export type QuoteDisplayState = 'live' | 'simulated' | 'unavailable';

export interface TickerItem {
  symbol: string;
  /** Уже отформатированная цена — форматирование остаётся за приложением */
  price: string;
  changePercent: number;
  href?: string;
  /** Не задано → 'live' (обратная совместимость с существующими вызовами) */
  state?: QuoteDisplayState;
}

export interface TickerTapeProps {
  items: TickerItem[];
  status?: ConnectionState;
  /** Локализованный aria-label ленты */
  ariaLabel?: string;
  /** Локализованная подпись индикатора соединения */
  connectionLabel?: string;
  /** Локализованная подпись на месте отсутствующей цены */
  noDataLabel?: string;
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
  noDataLabel = 'нет данных',
  className,
}: TickerTapeProps) {
  if (items.length === 0) return null;

  const simulated = status === 'simulated';

  const renderItems = (ariaHidden: boolean) =>
    items.map((item) => {
      // Данных нет — на месте цены прочерк, а не последнее известное значение
      const unavailable = item.state === 'unavailable';
      const content = unavailable ? (
        <>
          <span className="font-medium text-primary">{item.symbol}</span>
          <span className="tabular-nums text-secondary" title={noDataLabel}>
            —
          </span>
          <span className="text-[11px] uppercase tracking-wide text-secondary">{noDataLabel}</span>
        </>
      ) : (
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
    <div className={cn('border-b border-border bg-elevated', className)} aria-label={ariaLabel}>
      {/*
        Синтетические цены подписываются словами, а не только цветом точки:
        тултипа нет на тач-устройствах, а «неотличимо для посетителя» — ровно
        то, чем был баг B-018. Отдельной полосой над лентой, а не наложением
        внутри неё: лента с overflow-hidden обрезала бы подпись на узком
        экране — там, где тултипа как раз и нет.
      */}
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

        {/* Затемнение краёв, чтобы элементы «выплывали» мягко */}
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-gradient-to-r from-elevated to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l from-elevated to-transparent" />

        {/* Список дублируется для бесшовного цикла: анимация сдвигает ровно на 50% */}
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
