import { cn } from '@broker/ui';
import { Link } from '@/i18n/navigation';

/**
 * Сегментный переключатель на ссылках (`?tab=`/`?account=`): работает без JS,
 * переживает перезагрузку и «назад». На телефоне — во всю ширину, сегменты
 * равные, высота 44 px (цель касания).
 */
export function Segmented({
  items,
  active,
  label,
  className,
}: {
  items: { key: string; label: React.ReactNode; href: string }[];
  active: string;
  label: string;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn('flex rounded-xl border border-border bg-sunken p-1', className)}>
      {items.map((it) => {
        const on = it.key === active;
        return (
          <Link
            key={it.key}
            href={it.href}
            aria-current={on ? 'page' : undefined}
            className={cn(
              'flex min-h-[40px] flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm transition-colors',
              on ? 'bg-card font-semibold text-primary ring-1 ring-inset ring-border-strong' : 'text-secondary hover:text-primary',
            )}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
