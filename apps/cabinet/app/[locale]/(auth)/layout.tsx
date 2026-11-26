import { getLocale, getTranslations } from 'next-intl/server';
import { getChromeBrand, resolveBrandName, siteHref } from '@/lib/chrome';
import { getSiteLanguages } from '@/lib/site-languages';
import { LangSwitcher } from '@/features/shell/LangSwitcher';
import { BrandMark } from '@broker/ui';

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
        <BrandMark name={brandName} logo={brand?.logo} mode={brand?.logoMode} size="lg" />
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
