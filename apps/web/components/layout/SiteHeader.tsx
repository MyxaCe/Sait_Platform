'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Link, usePathname } from '@/i18n/navigation';
import { Button, Container, cn } from '@broker/ui';
import { LangSwitcher } from './LangSwitcher';
import { ThemeToggle } from './ThemeToggle';

export interface SiteHeaderProps {
  /** Название бренда и навигация приходят из CMS (тег cms:brand / cms:navigation) */
  brandName: string;
  /** Логотип из CMS; null — фолбэк на букву в квадрате */
  logo?: { url: string; width: number; height: number; alt: string } | null;
  nav: { label: string; href: string }[];
}

export function SiteHeader({ brandName, logo, nav }: SiteHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const t = useTranslations('nav');
  const tCommon = useTranslations('common');

  // Закрываем мобильное меню при переходе на другую страницу
  useEffect(() => setMenuOpen(false), [pathname]);

  // Блокируем скролл body под открытым меню
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-base/80 backdrop-blur-xl">
      <Container className="flex h-16 items-center justify-between gap-4 lg:h-[72px]">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold text-primary">
          {logo ? (
            // Обычный <img>: файл отдаёт CMS с другого origin — next/image
            // потребовал бы remotePatterns и проксирование через сервер сайта.
            // width/height из контракта обязательны — защита от CLS (R-05).
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logo.url}
              width={logo.width}
              height={logo.height}
              alt={logo.alt || brandName}
              className="h-8 w-auto"
            />
          ) : (
            <span className="grid size-8 place-items-center rounded-lg bg-accent font-bold text-base">
              {brandName.charAt(0)}
            </span>
          )}
          {brandName}
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label={t('mainNav')}>
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'rounded-lg px-3.5 py-2 text-sm transition-colors',
                pathname.startsWith(item.href)
                  ? 'text-primary'
                  : 'text-secondary hover:bg-primary/5 hover:text-primary',
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <LangSwitcher />
          <ThemeToggle />
          <Link href="/login">
            <Button variant="ghost" size="sm" tabIndex={-1}>
              {tCommon('login')}
            </Button>
          </Link>
          <Link href="/register">
            <Button size="sm" tabIndex={-1}>
              {tCommon('openAccount')}
            </Button>
          </Link>
        </div>

        <div className="flex items-center gap-1 lg:hidden">
          <LangSwitcher />
          <ThemeToggle />
          {/* Burger — только mobile/tablet, touch-target 44px */}
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-label={menuOpen ? t('closeMenu') : t('openMenu')}
            className="grid size-11 place-items-center rounded-lg text-primary hover:bg-primary/5"
          >
            <span className="relative block h-4 w-6">
              <span
                className={cn(
                  'absolute left-0 top-0 h-0.5 w-full bg-current transition-transform duration-300',
                  menuOpen && 'top-1/2 -translate-y-1/2 rotate-45',
                )}
              />
              <span
                className={cn(
                  'absolute left-0 top-1/2 h-0.5 w-full -translate-y-1/2 bg-current transition-opacity duration-300',
                  menuOpen && 'opacity-0',
                )}
              />
              <span
                className={cn(
                  'absolute bottom-0 left-0 h-0.5 w-full bg-current transition-transform duration-300',
                  menuOpen && 'bottom-1/2 translate-y-1/2 -rotate-45',
                )}
              />
            </span>
          </button>
        </div>
      </Container>

      {/* Mobile drawer */}
      <div
        className={cn(
          'fixed inset-x-0 bottom-0 top-16 z-40 flex flex-col bg-base transition-all duration-300 lg:hidden',
          menuOpen ? 'visible opacity-100' : 'invisible opacity-0',
        )}
      >
        <nav className="flex-1 overflow-y-auto px-4 py-6" aria-label={t('mobileNav')}>
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-xl px-4 py-4 text-lg font-medium text-primary hover:bg-primary/5"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-col gap-3 border-t border-border p-4 pb-8">
          <Link href="/register">
            <Button size="lg" className="w-full" tabIndex={-1}>
              {tCommon('openAccount')}
            </Button>
          </Link>
          <Link href="/login">
            <Button variant="secondary" size="lg" className="w-full" tabIndex={-1}>
              {tCommon('login')}
            </Button>
          </Link>
        </div>
      </div>
    </header>
  );
}
