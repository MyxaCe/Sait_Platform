import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { SiteFooter } from '@broker/ui';
import { CabinetHeader } from '@/features/shell/CabinetHeader';
import { LogoutForm } from '@/features/shell/LogoutForm';
import { MobileNav } from '@/features/shell/MobileNav';
import { NavIcon } from '@/features/shell/NavIcon';
import { CountBadge, NavLink, type NavItem } from '@/features/shell/NavLink';
import { Link } from '@/i18n/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getChromeBrand, getChromeFooter, siteHref, resolveBrandName } from '@/lib/chrome';
import { countUnread } from '@/lib/data';

interface LayoutProps {
  children: React.ReactNode;
  params: { locale: string };
}

/** Защищённая зона: настоящая валидация сессии (middleware проверяет только куку). */
export default async function AppLayout({ children, params }: LayoutProps) {
  setRequestLocale(params.locale);
  const user = await getSessionUser();
  if (!user) {
    redirect(params.locale === 'en' ? '/en/login' : '/login');
  }

  const [tNav, tCommon, unread, brand, footer] = await Promise.all([
    getTranslations('nav'),
    getTranslations('common'),
    countUnread(user.id),
    getChromeBrand(params.locale),
    getChromeFooter(params.locale),
  ]);
  const brandName = resolveBrandName(brand, tCommon('cabinet'));

  // Навигация (r2): 4 раздела счёта + аккаунт. Кошелёк = пополнение и вывод,
  // Профиль = личные данные, верификация, безопасность и документы.
  // Место под «Акции» / «Пригласи друга» — третья группа (их проектирует
  // отдельная команда; добавить = строка в `growthNav`).
  const accountNav: NavItem[] = [
    { href: '/', label: tNav('dashboard'), icon: 'home' },
    { href: '/trade', label: tNav('trade'), icon: 'trade' },
    { href: '/wallet', label: tNav('wallet'), icon: 'wallet' },
    { href: '/history', label: tNav('history'), icon: 'history' },
  ];
  const profileNav: NavItem[] = [
    { href: '/profile', label: tNav('profile'), icon: 'profile' },
    { href: '/notifications', label: tNav('notifications'), icon: 'notifications', badge: unread },
  ];
  const growthNav: NavItem[] = [];
  // Телефон: 4 главных + «Ещё». Короткие подписи — чтобы влезали в 390 px.
  const mobilePrimary: NavItem[] = [
    { href: '/', label: tNav('short.dashboard'), icon: 'home' },
    { href: '/trade', label: tNav('short.trade'), icon: 'trade' },
    { href: '/wallet', label: tNav('short.wallet'), icon: 'wallet' },
    { href: '/history', label: tNav('short.history'), icon: 'history' },
  ];
  const mobileMore: NavItem[] = [...profileNav, ...growthNav];

  return (
    <div className="flex min-h-svh flex-col">
      {/* Шапка ЛК: бренд-зона как у сайта + пользователь (ADR-026) */}
      <div className="hidden lg:block">
        <CabinetHeader brand={brand} user={user} locale={params.locale} />
      </div>

      {/* Мобильная шапка: бренд + уведомления. Выход — в «Ещё». */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-elevated/95 px-4 backdrop-blur lg:hidden">
        <Link href="/" className="flex min-w-0 items-center gap-2 font-semibold">
          {brand?.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logo.url} alt={brand.logo.alt || brandName} className="h-7 w-auto" />
          ) : (
            <span className="grid size-7 place-items-center rounded-lg bg-accent text-sm font-bold text-on-accent">
              {brandName.charAt(0)}
            </span>
          )}
          <span className="truncate">{tCommon('cabinet')}</span>
        </Link>
        <Link
          href="/notifications"
          aria-label={tNav('notifications')}
          className="relative -mr-2 grid size-11 place-items-center rounded-lg text-secondary hover:text-primary"
        >
          <NavIcon name="notifications" className="size-[22px]" />
          {unread > 0 ? <CountBadge value={unread} className="absolute right-0.5 top-1 h-[18px] min-w-[18px] px-1 text-[10px]" /> : null}
        </Link>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-elevated p-4 lg:flex">
          <nav className="flex flex-1 flex-col gap-0.5" aria-label={tNav('menu')}>
            {accountNav.map((item) => (
              <NavLink key={item.href} item={item} />
            ))}
            <p className="mt-5 px-3 pb-1.5 text-[11px] font-medium text-muted">{tNav('groupProfile')}</p>
            {profileNav.map((item) => (
              <NavLink key={item.href} item={item} />
            ))}
            {growthNav.length > 0 ? (
              <>
                <p className="mt-5 px-3 pb-1.5 text-[11px] font-medium text-muted">{tNav('groupGrowth')}</p>
                {growthNav.map((item) => (
                  <NavLink key={item.href} item={item} />
                ))}
              </>
            ) : null}
          </nav>
          <a
            href={siteHref('/', params.locale)}
            className="border-t border-border px-3 pt-4 text-sm text-secondary transition-colors hover:text-primary"
          >
            ← {tCommon('backToSite')}
          </a>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <main className="flex-1 px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-5 sm:px-6 lg:px-10 lg:pb-8 lg:pt-8">{children}</main>

          {/* Общий футер платформы (ADR-025): те же данные CMS, что у сайта */}
          {footer && (
            <div className="hidden lg:block">
              <SiteFooter
                columns={footer.columns.map((col) => ({
                  title: col.title,
                  links: col.links.map((l) => ({ label: l.label, href: siteHref(l.href, params.locale) })),
                }))}
                riskWarning={footer.riskWarning}
                brandName={brandName}
                socials={brand?.socials ?? []}
                copyright={tCommon('copyright', { year: new Date().getFullYear(), brand: brandName })}
              />
            </div>
          )}
        </div>
      </div>

      <MobileNav
        primary={mobilePrimary}
        more={mobileMore}
        labels={{ more: tNav('more'), close: tNav('close'), sheetTitle: tNav('moreTitle'), nav: tNav('menu') }}
        footer={
          <>
            <a
              href={siteHref('/', params.locale)}
              className="flex h-12 items-center gap-3 rounded-lg px-3 text-[15px] text-secondary hover:bg-primary/5"
            >
              <NavIcon name="site" />
              {tCommon('backToSite')}
            </a>
            <LogoutForm
              locale={params.locale}
              label={tCommon('logout')}
              icon={<NavIcon name="logout" />}
              className="flex h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-[15px] text-negative hover:bg-negative/10"
            />
          </>
        }
      />
    </div>
  );
}
