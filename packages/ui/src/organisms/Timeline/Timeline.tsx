import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import type { StatusTone } from '../../molecules/StatusBadge/StatusBadge';

/**
 * Лента событий (концепция §6.13) — история верификации, журнал по субъекту,
 * история заявки. Новые сверху. Точка окрашена тоном события (та же семантика,
 * что у бейджей). `details` — раскрываемый блок (payload, хэши) через нативный
 * `<details>`: работает без JS.
 */
export interface TimelineItem {
  key: string;
  title: ReactNode;
  /** Время (уже отформатированное) — справа, табличными цифрами. */
  time: ReactNode;
  /** Кто/откуда: «Мария Орлова · seq 49». */
  meta?: ReactNode;
  /** Основание/описание. */
  body?: ReactNode;
  details?: ReactNode;
  detailsLabel?: string;
  tone?: StatusTone;
}

const DOT: Record<StatusTone, string> = {
  neutral: 'bg-muted',
  info: 'bg-info',
  positive: 'bg-positive',
  warning: 'bg-warning',
  negative: 'bg-negative',
};

export interface TimelineProps {
  items: TimelineItem[];
  className?: string;
}

export function Timeline({ items, className }: TimelineProps) {
  return (
    <ol className={cn('relative', className)}>
      {items.map((e, i) => (
        <li key={e.key} className="relative flex gap-3 pb-4 last:pb-0">
          {i < items.length - 1 ? (
            <span
              aria-hidden
              className="bg-border-strong absolute left-[5px] top-4 h-[calc(100%-8px)] w-px"
            />
          ) : null}
          <span
            aria-hidden
            className={cn(
              'ring-card relative mt-1.5 size-[11px] shrink-0 rounded-full ring-[3px]',
              DOT[e.tone ?? 'neutral'],
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="text-primary text-sm font-medium">{e.title}</p>
              <span className="text-muted whitespace-nowrap text-xs tabular-nums">{e.time}</span>
            </div>
            {e.meta ? <p className="text-secondary text-xs">{e.meta}</p> : null}
            {e.body ? <div className="text-secondary mt-1 text-sm">{e.body}</div> : null}
            {e.details ? (
              <details className="group mt-1.5">
                <summary className="text-muted hover:text-primary cursor-pointer select-none text-xs">
                  {e.detailsLabel ?? 'Подробности'}
                </summary>
                <div className="mt-2">{e.details}</div>
              </details>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
