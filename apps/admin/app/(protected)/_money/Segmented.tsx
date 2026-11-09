import Link from 'next/link';
import { cn } from '@broker/ui';

/**
 * Фильтр-переключатель внутри вкладки (GET-ссылки, работает без JS, значение
 * — в URL). Плотный, 32 px, со счётчиком. Кандидат в @broker/ui
 * (`FilterChips`) — пока локально, пакет UI в фазе 2 не трогаем.
 */
export interface SegmentItem {
  key: string;
  label: string;
  href: string;
  count?: number;
}

export function Segmented({
  items,
  active,
  label,
}: {
  items: SegmentItem[];
  active: string;
  label: string;
}) {
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-1">
      {items.map((it) => {
        const on = it.key === active;
        return (
          <Link
            key={it.key}
            href={it.href}
            scroll={false}
            aria-current={on ? 'true' : undefined}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px]',
              on
                ? 'bg-accent/[0.12] text-primary font-medium ring-1 ring-inset ring-accent/30'
                : 'text-secondary hover:bg-primary/5 hover:text-primary',
            )}
          >
            {it.label}
            {it.count != null ? (
              <span className="text-muted text-xs tabular-nums">{it.count}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
