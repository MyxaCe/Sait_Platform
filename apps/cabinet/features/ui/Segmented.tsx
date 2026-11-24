import { cn } from '@broker/ui';
import { Link } from '@/i18n/navigation';

export function Segmented({
  items,
  active,
  label,
  className,
  vertical = false,
  stretch = false,
  keepScroll = false,
}: {
  items: { key: string; label: React.ReactNode; href: string }[];
  active: string;
  label: string;
  className?: string;
  vertical?: boolean;
  /** Вертикальное меню растягивается до высоты соседней колонки (без «лесенки»). */
  stretch?: boolean;
  /** Переключение вкладок без прокрутки страницы наверх (вкладки одной страницы). */
  keepScroll?: boolean;
}) {
  return (
    <nav
      aria-label={label}
      className={cn('flex rounded-xl border border-border bg-sunken p-1', className, vertical && 'xl:flex xl:flex-col xl:gap-0.5', vertical && stretch && 'xl:flex-1')}
    >
      {items.map((it) => {
        const on = it.key === active;
        return (
          <Link
            key={it.key}
            href={it.href}
            scroll={keepScroll ? false : undefined}
            aria-current={on ? 'page' : undefined}
            className={cn(
              'flex min-h-[40px] flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm transition-colors',
              vertical && (stretch ? 'xl:max-h-16 xl:flex-1 xl:justify-start' : 'xl:flex-none xl:justify-start'),
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
