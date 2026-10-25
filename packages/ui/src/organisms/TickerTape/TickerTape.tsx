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
  /**
   * Уже отформатированная цена — форматирование остаётся за приложением.
   *
   * `null` — настоящего чтения ещё НЕ БЫЛО (стартовый снапшот справочника).
   * Это не то же, что «цена устарела»: устаревшую мы гасим и помечаем
   * (Р-070), а несуществующую показать нечем. Решает приложение: только
   * оно знает, читалась ли цена на самом деле.
   */
  price: string | null;
  /**
   * `null` — изменение неизвестно при известной цене. Не путать с
   * `state: 'unavailable'`: там нет самой котировки и прочерк встаёт на место
   * цены, здесь цена настоящая и прочерк встаёт только на место изменения.
   */
  changePercent: number | null;
  href?: string;
  /** Не задано → 'live' (обратная совместимость с существующими вызовами) */
  state?: QuoteDisplayState;
  /**
   * Локализованное объяснение, ПОЧЕМУ цены нет.
   *
   * Приходит готовой строкой: дизайн-система не знает ни переводов, ни
   * машинных причин источника — ровно как с остальными подписями.
   *
   * Без неё молчащий инструмент выглядит сломанным, а не ограниченным:
   * прочерк сам по себе ничего не объясняет, а рядом с соседними
   * числами читается как «тут неизвестно, а там известно».
   */
  unavailableLabel?: string;
  /**
   * Короткая ВИДИМАЯ подпись вместо общего «нет данных».
   *
   * Полная фраза живёт в тултипе, но полагаться на него нельзя: в этом
   * же файле строкой ниже записано, почему синтетические цены
   * подписаны видимой полосой, а не наведением — **тултипа нет на
   * сенсорных экранах**. Повторять здесь ту же ошибку, только текстом
   * про недоступность, было бы странно.
   *
   * Поэтому различие «так устроено пока» против «у нас неполадка»
   * видно без наведения; подробность — при наведении.
   */
  unavailableShort?: string;
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
  /**
   * Локализованная метка при погашенной цене: число настоящее, но оно
   * последнее известное, а не текущее. Без неё гашение превратилось бы в
   * показ старой цены как текущей — то самое, что Р-070 запрещает.
   */
  lastKnownLabel?: string;
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
  lastKnownLabel = 'последняя известная',
  className,
}: TickerTapeProps) {
  if (items.length === 0) return null;

  const simulated = status === 'simulated';

  const renderItems = (ariaHidden: boolean) =>
    items.map((item) => {
      /*
       * Отказ ГАСИТ число и ставит метку, но не стирает его (Р-070, PKG-06).
       *
       * Прежняя цена была верна на момент последнего успешного чтения.
       * Неправдой было бы показать её как ТЕКУЩУЮ — а не показать вовсе.
       * Стереть её значит заменить одно правдоподобное утверждение другим:
       * пустая полоса читается как «котировок нет».
       *
       * Но гасить можно только НАСТОЯЩЕЕ чтение. Если его ещё не было,
       * гасить нечего, и тогда прочерк — единственный честный ответ. Иначе
       * мы выдали бы за «последнюю известную цену» зашитую базовую: ровно
       * тот дефект, который §5г нашёл внутри себя, когда справочник с
       * `ts = 0` рисовался как котировки.
       */
      const unavailable = item.state === 'unavailable';
      const content = unavailable ? (
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
          {/* Живой цены может не быть и здесь — тогда прочерк, не пустота. */}
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
