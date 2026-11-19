import { getLocale, getTranslations } from 'next-intl/server';
import { getChromeBrand, resolveBrandName, siteHref } from '@/lib/chrome';
import { getSiteLanguages } from '@/lib/site-languages';
import { LangSwitcher } from '@/features/shell/LangSwitcher';

/** Публичная зона: центрированная карточка; бренд — из CMS (ADR-025). */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const t = await getTranslations('common');
  const brand = await getChromeBrand(locale);
  const brandName = resolveBrandName(brand, t('cabinet'));
  const site = await getSiteLanguages();

  return (
    <main className="relative flex min-h-svh flex-col items-center justify-center px-4 py-10">
      <LangSwitcher className="absolute right-4 top-4" />
      <div className="mb-8 flex items-center gap-2 text-xl font-semibold">
        {brand?.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brand.logo.url} alt={brand.logo.alt || brandName} className="h-9 w-auto" />
        ) : (
          <span className="grid size-9 place-items-center rounded-lg bg-accent font-bold text-on-accent">
            {brandName.charAt(0)}
          </span>
        )}
        {brandName}
      </div>
      <div className="w-full max-w-md rounded-2xl border border-border bg-elevated p-6 sm:p-8">
        {children}
      </div>
      <a
        href={siteHref('/', locale, site.defaultLanguage)}
        className="mt-6 text-sm text-secondary hover:text-primary"
      >
        ← {t('backToSite')}
      </a>
    </main>
  );
}
