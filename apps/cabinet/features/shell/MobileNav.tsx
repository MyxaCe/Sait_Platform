'use client';

import { useEffect, useRef, useState } from 'react';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@broker/ui';
import { NavIcon } from './NavIcon';
import { CountBadge, isActive, type NavItem } from './NavLink';

/**
 * Нижняя навигация телефона (аудит К1/К2): 4 главных раздела + «Ещё».
 * «Ещё» открывает шторку со всеми остальными разделами, «На сайт» и выходом.
 *
 * Панель — 64 px + отступ под жестовую полосу (`env(safe-area-inset-bottom)`,
 * работает при `viewport-fit=cover` в корневом layout). Контент страницы
 * получает такой же нижний отступ в layout — панель его не перекрывает.
 */
export function MobileNav({
  primary,
  more,
  labels,
  footer,
}: {
  primary: NavItem[];
  more: NavItem[];
  labels: { more: string; close: string; sheetTitle: string; nav: string };
  /** Низ шторки: «На сайт» и выход (серверные ссылки/формы). */
  footer?: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const moreActive = more.some((i) => isActive(pathname, i.href));
  const moreBadge = more.reduce((n, i) => n + (i.badge ?? 0), 0);

  // Переход по пункту закрывает шторку.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sheetRef.current?.querySelector<HTMLElement>('a,button')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const tab = 'flex min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[11px] leading-none';

  return (
    <>
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label={labels.close}
            className="absolute inset-0 bg-base/70"
            onClick={() => setOpen(false)}
          />
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label={labels.sheetTitle}
            className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-border-strong bg-elevated pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
          >
            <div className="flex items-center justify-between px-5 pb-2 pt-4">
              <p className="text-sm font-semibold">{labels.sheetTitle}</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="-mr-2 grid size-10 place-items-center rounded-lg text-secondary hover:bg-primary/5 hover:text-primary"
                aria-label={labels.close}
              >
                <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                  <path d="m5 5 10 10M15 5 5 15" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <nav className="px-3">
              <ul className="flex flex-col">
                {more.map((item) => {
                  const active = isActive(pathname, item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex h-12 items-center gap-3 rounded-lg px-3 text-[15px]',
                          active ? 'bg-accent/[0.12] font-medium text-accent' : 'text-primary hover:bg-primary/5',
                        )}
                      >
                        <NavIcon name={item.icon} className={cn('size-5 shrink-0', !active && 'text-secondary')} />
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {item.badge ? <CountBadge value={item.badge} /> : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
            {footer ? <div className="mx-3 mt-2 border-t border-border px-0 pt-2">{footer}</div> : null}
          </div>
        </div>
      ) : null}

      <nav
        aria-label={labels.nav}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-elevated/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        <ul className="flex h-16">
          {primary.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href} className="flex min-w-0 flex-1">
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(tab, active ? 'text-accent' : 'text-secondary')}
                >
                  <NavIcon name={item.icon} className="size-[22px] shrink-0" />
                  <span className="max-w-full truncate px-1">{item.label}</span>
                </Link>
              </li>
            );
          })}
          <li className="flex min-w-0 flex-1">
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className={cn(tab, moreActive || open ? 'text-accent' : 'text-secondary')}
            >
              <span className="relative">
                <NavIcon name="more" className="size-[22px] shrink-0" />
                {moreBadge > 0 ? (
                  <span aria-hidden className="absolute -right-1.5 -top-1 size-2.5 rounded-full border-2 border-elevated bg-accent" />
                ) : null}
              </span>
              <span className="max-w-full truncate px-1">{labels.more}</span>
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
