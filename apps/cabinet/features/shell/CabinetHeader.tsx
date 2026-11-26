import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { LangSwitcher } from '@/features/shell/LangSwitcher';
import { HelpButton } from '@/features/tour/HelpButton';
import { LogoutForm } from '@/features/shell/LogoutForm';
import type { SessionUser } from '@/lib/auth/session';
import { resolveBrandName, type ChromeBrand } from '@/lib/chrome';
import { BrandMark } from '@broker/ui';

export async function CabinetHeader({
  brand,
  user,
  locale,
  siteHome,
  siteNav,
}: {
  brand: ChromeBrand | null;
  user: SessionUser;
  locale: string;
  siteHome: string;
  siteNav: { href: string; label: string }[];
}) {
  const t = await getTranslations('common');
  const brandName = resolveBrandName(brand, t('cabinet'));

  return (
    <header className="sticky top-0 z-50 flex h-16 items-center justify-between gap-4 border-b border-border bg-base/80 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <a
          href={siteHome}
          className="flex items-center gap-2 text-lg font-semibold text-primary"
          aria-label={t('mainSite', { brand: brandName })}
          title={t('mainSite', { brand: brandName })}
          data-header-site-home
        >
          <BrandMark name={brandName} logo={brand?.logo} mode={brand?.logoMode} size="md" nameClassName="hidden sm:inline" />
        </a>
        <Link
          href="/"
          className="rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-secondary transition-colors hover:text-primary"
        >
          {t('cabinet')}
        </Link>
      </div>

      {siteNav.length > 0 ? (
        <nav className="hidden min-w-0 items-center gap-0.5 xl:flex" aria-label={t('siteNav')} data-header-site-nav>
          {siteNav.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="whitespace-nowrap rounded-lg px-3 py-2 text-sm text-secondary transition-colors hover:bg-primary/5 hover:text-primary"
            >
              {item.label}
            </a>
          ))}
        </nav>
      ) : null}

      <div className="flex shrink-0 items-center gap-3">
        <a
          href={siteHome}
          className={
            siteNav.length > 0
              ? 'hidden rounded-lg px-3 py-2 text-sm text-secondary transition-colors hover:bg-primary/5 hover:text-primary lg:inline-flex xl:hidden'
              : 'hidden rounded-lg px-3 py-2 text-sm text-secondary transition-colors hover:bg-primary/5 hover:text-primary lg:inline-flex'
          }
        >
          ← {t('backToSite')}
        </a>
        <HelpButton />
        <LangSwitcher />
        <Link href="/profile" className="flex items-center gap-3 rounded-lg px-1 py-1 transition-colors hover:bg-primary/5">
          <span className="hidden text-right sm:block">
            <span className="block max-w-48 truncate text-sm text-primary">{user.fullName}</span>
            <span className="block text-xs text-secondary">UID {user.uid ?? '—'}</span>
          </span>
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent/20 text-sm font-semibold text-accent">
            {user.fullName.charAt(0).toUpperCase()}
          </span>
        </Link>
        <LogoutForm
          locale={locale}
          label={t('logout')}
          className="rounded-lg px-3 py-2 text-sm text-secondary transition-colors hover:bg-primary/5 hover:text-negative"
        />
      </div>
    </header>
  );
}
