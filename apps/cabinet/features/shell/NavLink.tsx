'use client';

import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@broker/ui';
import { NavIcon, type NavIconName } from './NavIcon';

export interface NavItem {
  href: string;
  label: string;
  icon: NavIconName;
  badge?: number;
}

/** Активен ли пункт для текущего пути (главная — только точное совпадение). */
export function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

/** Пункт боковой навигации (десктоп). */
export function NavLink({ item }: { item: NavItem }) {
  const pathname = usePathname();
  const active = isActive(pathname, item.href);

  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors',
        active
          ? 'bg-accent/[0.12] font-medium text-accent'
          : 'text-secondary hover:bg-primary/5 hover:text-primary',
      )}
    >
      <NavIcon name={item.icon} className="size-[18px] shrink-0" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.badge ? <CountBadge value={item.badge} /> : null}
    </Link>
  );
}

export function CountBadge({ value, className }: { value: number; className?: string }) {
  return (
    <span
      className={cn(
        'grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[11px] font-semibold tabular-nums text-on-accent',
        className,
      )}
    >
      {value > 99 ? '99+' : value}
    </span>
  );
}
