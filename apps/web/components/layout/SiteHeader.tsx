'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Link, usePathname } from '@/i18n/navigation';
import { BrandMark, Button, Container, cn, type BrandLogoMode } from '@broker/ui';
import { LangSwitcher } from './LangSwitcher';
import { ThemeToggle } from './ThemeToggle';
import { envOr } from '@broker/utils';
import { localizedPath } from '@broker/utils/locales';
import { hasSessionHint } from '@broker/utils/session-hint';
import { useSiteLanguages } from '@/i18n/site-languages-context';

const CABINET_URL = envOr(process.env.NEXT_PUBLIC_CABINET_URL, 'http://localhost:3002').replace(
  /\/$/,
  '',
);

function cabinetHref(path: '/' | '/login' | '/register', locale: string, defaultLanguage: string): string {
  return `${CABINET_URL}${localizedPath(path, locale, defaultLanguage)}`;
}

export interface SiteHeaderProps {
  brandName: string;
  logo?: { url: string; width: number; height: number; alt: string } | null;
  logoMode?: BrandLogoMode | null;
  nav: { label: string; href: string }[];
}

export function SiteHeader({ brandName, logo, logoMode, nav }: SiteHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const locale = useLocale();
  const { defaultLanguage } = useSiteLanguages();
  const t = useTranslations('nav');
  const tCommon = useTranslations('common');

  useEffect(() => setMenuOpen(false), [pathname]);

  // Флажок «вошёл в кабинет» ставит кабинет на общий домен (без секретов). Читаем после гидрации,
  // чтобы страницы витрины оставались кешируемыми: сервер всегда отдаёт «Войти / Открыть счёт».
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    setSignedIn(hasSessionHint(document.cookie));
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-base/80 backdrop-blur-xl">
      <Container className="flex h-16 items-center justify-between gap-4 lg:h-[72px]">
        <Link href="/" aria-label={brandName} className="flex min-w-0 items-center text-lg font-semibold text-primary">
          <BrandMark name={brandName} logo={logo} mode={logoMode} size="md" />
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
          {signedIn ? (
            <a href={cabinetHref('/', locale, defaultLanguage)} data-header-cabinet>
              <Button size="sm" tabIndex={-1}>
                <span aria-hidden className="mr-1.5 inline-block size-2 rounded-full bg-current opacity-70" />
                {tCommon('toCabinet')}
              </Button>
            </a>
          ) : (
            <>
              <a href={cabinetHref('/login', locale, defaultLanguage)}>
                <Button variant="ghost" size="sm" tabIndex={-1}>
                  {tCommon('login')}
                </Button>
              </a>
              <a href={cabinetHref('/register', locale, defaultLanguage)}>
                <Button size="sm" tabIndex={-1}>
                  {tCommon('openAccount')}
                </Button>
              </a>
            </>
          )}
        </div>

        <div className="flex items-center gap-1 lg:hidden">
          <LangSwitcher />
          <ThemeToggle />
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
          {signedIn ? (
            <a href={cabinetHref('/', locale, defaultLanguage)} data-header-cabinet>
              <Button size="lg" className="w-full" tabIndex={-1}>
                {tCommon('toCabinet')}
              </Button>
            </a>
          ) : (
            <>
              <a href={cabinetHref('/register', locale, defaultLanguage)}>
                <Button size="lg" className="w-full" tabIndex={-1}>
                  {tCommon('openAccount')}
                </Button>
              </a>
              <a href={cabinetHref('/login', locale, defaultLanguage)}>
                <Button variant="secondary" size="lg" className="w-full" tabIndex={-1}>
                  {tCommon('login')}
                </Button>
              </a>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
