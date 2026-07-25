import { getLocale, getTranslations } from 'next-intl/server';
import { getChromeBrand } from '@/lib/chrome';

/** Публичная зона: центрированная карточка; бренд — из CMS (ADR-025). */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const t = await getTranslations('common');
  const brand = await getChromeBrand(locale);
  const brandName = brand?.name ?? t('brand');

  return (
    <main className="flex min-h-svh flex-col items-center justify-center px-4 py-10">
      <div className="mb-8 flex items-center gap-2 text-xl font-semibold">
        {brand?.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brand.logo.url} alt={brand.logo.alt || brandName} className="h-9 w-auto" />
        ) : (
          <span className="grid size-9 place-items-center rounded-lg bg-accent font-bold text-base">
            {brandName.charAt(0)}
          </span>
        )}
        {brandName}
      </div>
      <div className="w-full max-w-md rounded-2xl border border-border bg-elevated p-6 sm:p-8">
        {children}
      </div>
      <a
        href={process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}
        className="mt-6 text-sm text-secondary hover:text-primary"
      >
        ← {t('backToSite')}
      </a>
    </main>
  );
}
