import type { ElementType } from 'react';
import { cn } from '../../lib/cn';

/**
 * Хлебные крошки (концепция §6.10). Последний элемент — текущая страница, не
 * ссылка (`aria-current`). Ссылку отдаёт потребитель (`linkComponent` =
 * next/link) — пакет остаётся без next-зависимостей.
 */
export interface Crumb {
  label: string;
  href?: string;
}

export interface BreadcrumbsProps {
  items: Crumb[];
  linkComponent?: ElementType;
  className?: string;
}

export function Breadcrumbs({ items, linkComponent: Link = 'a', className }: BreadcrumbsProps) {
  return (
    <nav aria-label="Навигационная цепочка" className={cn('text-xs', className)}>
      <ol className="text-muted flex flex-wrap items-center gap-1.5">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${c.label}-${i}`} className="flex items-center gap-1.5">
              {c.href && !last ? (
                <Link href={c.href} className="text-secondary hover:text-primary">
                  {c.label}
                </Link>
              ) : (
                <span
                  aria-current={last ? 'page' : undefined}
                  className={cn(last && 'text-primary')}
                >
                  {c.label}
                </span>
              )}
              {last ? null : <span aria-hidden>/</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
