'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@broker/ui';
import { NavIcon } from './NavIcon';
import { NAV_GROUPS, type NavItem } from './nav-registry';

/**
 * Левый навигационный рельс (концепция §8.1): марка продукта сверху, пункты
 * сгруппированы по задачам оператора (Обзор / Клиенты и комплаенс / Деньги и
 * риск / Контроль). Активный пункт — заливка + акцентная полоска слева
 * (`aria-current="page"`), не только цвет. `danger`-пункт (break-glass)
 * визуально отделён красным.
 *
 * Пункты уже отфильтрованы по роли на сервере (fail-closed, Р-394): клиентский
 * рельс не знает о скрытых разделах вовсе; пустая для роли группа не рисуется.
 */
export function NavRail({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  function isActive(item: NavItem): boolean {
    if (item.exact) return pathname === item.href;
    // /risk/leverage и /risk/portfolios — один раздел «Риск».
    const base = item.href.startsWith('/risk/') ? '/risk' : item.href;
    return pathname === base || pathname.startsWith(`${base}/`);
  }

  return (
    <nav
      aria-label="Разделы центра управления"
      className="border-border bg-elevated w-60 shrink-0 border-r"
    >
      <div className="sticky top-0 flex h-svh flex-col">
        <div className="border-border flex h-14 items-center gap-2.5 border-b px-4">
          <span
            aria-hidden
            className="bg-accent text-on-accent flex size-7 items-center justify-center rounded-md text-[13px] font-bold"
          >
            W
          </span>
          <span className="min-w-0 leading-tight">
            <span className="text-primary block truncate text-sm font-semibold">Wholesalefy</span>
            <span className="text-muted block truncate text-[11px]">Центр управления</span>
          </span>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {NAV_GROUPS.map((group) => {
            const groupItems = items.filter((i) => i.group === group.key);
            if (groupItems.length === 0) return null;
            return (
              <div key={group.key}>
                <p className="text-muted px-2.5 pb-1.5 text-[11px] font-medium">{group.label}</p>
                <ul className="space-y-0.5">
                  {groupItems.map((item) => {
                    const active = isActive(item);
                    return (
                      <li key={item.key}>
                        <Link
                          href={item.href}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm',
                            active
                              ? 'bg-accent/[0.12] text-primary font-medium'
                              : 'text-secondary hover:bg-primary/[0.05] hover:text-primary',
                            item.danger && 'text-negative hover:text-negative',
                          )}
                        >
                          {active ? (
                            <span
                              aria-hidden
                              className="bg-accent absolute inset-y-2 -left-3 w-[3px] rounded-r"
                            />
                          ) : null}
                          <NavIcon
                            name={item.icon}
                            className={cn(
                              'size-[18px] shrink-0',
                              active ? 'text-accent' : 'text-muted',
                            )}
                          />
                          <span className="truncate">{item.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
