'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@broker/ui';
import { ATTENTION_POLL_SECONDS, attentionBadgeText } from '@/lib/support/attention-badge';
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
function useSupportAttention(enabled: boolean, initial: number | null, pathname: string): number | null {
  const [count, setCount] = useState(initial);
  const mounted = useRef(false);
  useEffect(() => setCount(initial), [initial]);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/api/support/attention', { cache: 'no-store' });
        if (!res.ok) return;
        const body = (await res.json()) as { count?: unknown };
        if (alive && typeof body.count === 'number') setCount(body.count);
      } catch {
        return;
      }
    };
    if (mounted.current) void load();
    mounted.current = true;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, ATTENTION_POLL_SECONDS * 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [enabled, pathname]);
  return count;
}

export function CountBadge({ value, label }: { value: number | null; label: string }) {
  const text = attentionBadgeText(value);
  if (!text) return null;
  return (
    <span
      aria-label={label}
      title={label}
      className="bg-accent text-on-accent ml-auto grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums"
    >
      {text}
    </span>
  );
}

export function NavRail({ items, supportAttention = null }: { items: NavItem[]; supportAttention?: number | null }) {
  const pathname = usePathname();
  const hasSupport = items.some((i) => i.key === 'support');
  const attention = useSupportAttention(hasSupport, supportAttention, pathname);

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
                          {item.key === 'support' ? (
                            <CountBadge value={attention} label={`Ждут ответа оператора: ${attention ?? 0}`} />
                          ) : null}
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
