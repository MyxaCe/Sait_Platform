'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@broker/ui';
import { NavIcon } from './NavIcon';
import type { NavItem } from './nav-registry';

/**
 * Левый навигационный рельс (§2.1): плотный, иконка + подпись, текущий раздел
 * всегда на виду. Активный пункт — акцентная подсветка (accent = «важное»,
 * §5.1). `danger`-пункт (break-glass) визуально отделён красным — аварийную
 * дверь не прячем, но и не делаем «дешёвой».
 *
 * Пункты уже отфильтрованы по роли на сервере (fail-closed, Р-394): клиентский
 * рельс не знает о скрытых разделах вовсе.
 */
export function NavRail({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  function isActive(item: NavItem): boolean {
    if (item.exact) return pathname === item.href;
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  }

  return (
    <nav
      aria-label="Разделы центра управления"
      className="flex w-52 shrink-0 flex-col gap-1 border-r border-border bg-elevated p-2"
    >
      {items.map((item) => {
        const active = isActive(item);
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
              active
                ? 'bg-accent/15 text-accent'
                : 'text-secondary hover:bg-primary/5 hover:text-primary',
              item.danger && 'mt-2 border-t border-border pt-3',
              item.danger && (active ? 'text-negative' : 'text-negative/80 hover:text-negative'),
            )}
          >
            <NavIcon name={item.icon} className="shrink-0" />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
