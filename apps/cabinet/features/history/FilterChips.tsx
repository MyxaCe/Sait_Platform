import { cn } from '@broker/ui';
import { Link } from '@/i18n/navigation';

/** Фильтр-«чипы» на ссылках (значение в URL, работает без JS). */
export function FilterChips({
  label,
  items,
  active,
  vertical = false,
}: {
  label: string;
  /** ≥ 2xl — столбиком во всю ширину колонки фильтров (десктоп «Истории»). */
  vertical?: boolean;
  items: { key: string; label: string; href: string }[];
  active: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn('flex gap-1.5 overflow-x-auto', vertical && '2xl:flex-col 2xl:overflow-visible')}>
      {vertical ? <p className="hidden pb-1 text-xs font-medium text-muted 2xl:block">{label}</p> : null}
      {items.map((it) => {
        const on = it.key === active;
        return (
          <Link
            key={it.key}
            href={it.href}
            aria-current={on ? 'true' : undefined}
            className={cn(
              'inline-flex h-9 shrink-0 items-center rounded-full border px-3.5 text-[13px] transition-colors',
              vertical && '2xl:rounded-lg',
              on
                ? 'border-accent/50 bg-accent/[0.12] font-medium text-accent'
                : 'border-border text-secondary hover:border-border-strong hover:text-primary',
            )}
          >
            {it.label}
          </Link>
        );
      })}
    </div>
  );
}
