import type { ElementType } from 'react';
import { cn } from '../../lib/cn';

/**
 * Пагинация-ссылки (концепция §6.1): «Показано 51–100 из 1 284» слева,
 * «← Назад / стр. 2 из 26 / Вперёд →» справа. Серверная: каждая страница — URL
 * (`hrefFor(page)`), работает без JS. Размер страницы — 50 по умолчанию.
 */
export interface PaginationProps {
  /** Текущая страница, с 1. */
  page: number;
  pageSize: number;
  total: number;
  hrefFor: (page: number) => string;
  linkComponent?: ElementType;
  className?: string;
}

const nf = (n: number) => n.toLocaleString('ru-RU');

export function Pagination({
  page,
  pageSize,
  total,
  hrefFor,
  linkComponent: Link = 'a',
  className,
}: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = Math.min(total, current * pageSize);
  const btn = 'inline-flex h-8 items-center rounded-md border border-border px-2.5 text-[13px]';
  return (
    <nav
      aria-label="Страницы"
      className={cn('flex flex-wrap items-center justify-between gap-3 text-xs', className)}
    >
      <span className="text-muted tabular-nums">
        Показано {nf(from)}–{nf(to)} из {nf(total)}
      </span>
      <span className="flex items-center gap-2">
        {current > 1 ? (
          <Link href={hrefFor(current - 1)} className={cn(btn, 'text-primary hover:bg-primary/5')}>
            ← Назад
          </Link>
        ) : (
          <span aria-disabled className={cn(btn, 'text-muted opacity-60')}>
            ← Назад
          </span>
        )}
        <span className="text-secondary tabular-nums">
          стр. {current} из {pages}
        </span>
        {current < pages ? (
          <Link href={hrefFor(current + 1)} className={cn(btn, 'text-primary hover:bg-primary/5')}>
            Вперёд →
          </Link>
        ) : (
          <span aria-disabled className={cn(btn, 'text-muted opacity-60')}>
            Вперёд →
          </span>
        )}
      </span>
    </nav>
  );
}
