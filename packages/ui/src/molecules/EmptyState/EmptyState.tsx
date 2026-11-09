import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * Пустое состояние (концепция §6.9): говорит, ПОЧЕМУ пусто и что это значит
 * («Очередь пуста — клиентов, ожидающих проверки, нет»), а не «Нет данных».
 * Для «пусто из-за фильтра» — действие «Сбросить фильтр». Ошибку/недоступность
 * источника рисует `Callout`, не EmptyState: пусто ≠ сломалось.
 */
export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** `compact` — внутри панели/таблицы; `default` — на всю страницу. */
  size?: 'default' | 'compact';
  className?: string;
}

export function EmptyState({
  title,
  description,
  action,
  size = 'default',
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center text-center',
        size === 'compact' ? 'gap-1 py-6' : 'gap-2 py-14',
        className,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden
        className={cn('text-muted', size === 'compact' ? 'size-5' : 'size-7')}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      >
        <rect x="3.5" y="5" width="17" height="14" rx="2" />
        <path d="M3.5 13h4.25l1.25 2h6l1.25-2h4.25" strokeLinejoin="round" />
      </svg>
      <p className="text-primary text-sm font-medium">{title}</p>
      {description ? <p className="text-muted max-w-md text-xs">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
