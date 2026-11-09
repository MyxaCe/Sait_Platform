import type { ElementType, ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * Вкладки-ссылки (концепция §6.11): каждая вкладка — URL (`?tab=…`), поэтому
 * работают без JS, открываются в новой вкладке и переживают перезагрузку.
 * Server-safe. Счётчик справа от подписи; `countTone="warning"` — «есть что
 * делать» (напр. выводы на проверке).
 */
export interface TabItem {
  key: string;
  label: ReactNode;
  href: string;
  count?: number;
  countTone?: 'default' | 'warning' | 'negative';
}

export interface TabsProps {
  items: TabItem[];
  active: string;
  linkComponent?: ElementType;
  className?: string;
  'aria-label'?: string;
}

const COUNT: Record<NonNullable<TabItem['countTone']>, string> = {
  default: 'bg-primary/[0.07] text-secondary',
  warning: 'bg-warning/15 text-warning',
  negative: 'bg-negative/15 text-negative',
};

export function Tabs({
  items,
  active,
  linkComponent: Link = 'a',
  className,
  'aria-label': ariaLabel,
}: TabsProps) {
  return (
    <nav aria-label={ariaLabel ?? 'Разделы'} className={cn('border-border border-b', className)}>
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {items.map((t) => {
          const on = t.key === active;
          return (
            <li key={t.key}>
              <Link
                href={t.href}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'flex h-10 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm',
                  on
                    ? 'border-accent text-primary font-medium'
                    : 'text-secondary hover:border-border-strong hover:text-primary border-transparent',
                )}
              >
                {t.label}
                {t.count != null ? (
                  <span
                    className={cn(
                      'rounded px-1.5 text-xs font-medium tabular-nums',
                      COUNT[t.countTone ?? 'default'],
                    )}
                  >
                    {t.count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
