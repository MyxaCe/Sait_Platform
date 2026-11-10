import { cn } from '@broker/ui';
import { Link } from '@/i18n/navigation';

/** Фильтр-«чипы» на ссылках (значение в URL, работает без JS). */
export function FilterChips({
  label,
  items,
  active,
}: {
  label: string;
  items: { key: string; label: string; href: string }[];
  active: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-1.5 overflow-x-auto">
      {items.map((it) => {
        const on = it.key === active;
        return (
          <Link
            key={it.key}
            href={it.href}
            aria-current={on ? 'true' : undefined}
            className={cn(
              'inline-flex h-9 shrink-0 items-center rounded-full border px-3.5 text-[13px] transition-colors',
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
