import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { hexToRgbChannels } from '@broker/utils';
import { SiteLanguagesProvider } from '@/i18n/site-languages-context';
import { getSiteLanguages } from '@/lib/site-languages';
import { getChromeBrand, resolveBrandName, siteHref } from '@/lib/chrome';
import { onAccentChannels } from '@/lib/on-accent';
import '../globals.css';
import { CabinetCookieNotice } from '@/features/CabinetCookieNotice';

const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-sans',
  display: 'swap',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#08090c',
};

interface LayoutProps {
  children: React.ReactNode;
  params: { locale: string };
}

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'meta' });
  const tCommon = await getTranslations({ locale: params.locale, namespace: 'common' });
  const brand = resolveBrandName(await getChromeBrand(params.locale), tCommon('cabinet'));
  return {
    title: t('title', { brand }),
    description: t('description', { brand }),
    robots: { index: false, follow: false },
  };
}

export default async function RootLayout({ children, params }: LayoutProps) {
  const { locale } = params;
  const site = await getSiteLanguages();
  if (!(site.languages as readonly string[]).includes(locale)) notFound();

  setRequestLocale(locale);
  const messages = await getMessages();

  const brand = await getChromeBrand(locale);
  const accentChannels = brand?.primaryColor ? hexToRgbChannels(brand.primaryColor) : null;
  const onAccent = accentChannels ? onAccentChannels(accentChannels) : null;

  return (
    <html lang={locale} data-theme="dark" className={inter.variable}>
      <body className="bg-base font-sans text-primary">
        {accentChannels && (
          <style>{`:root{--accent:${accentChannels};--text-on-accent:${onAccent};}`}</style>
        )}
        <NextIntlClientProvider messages={messages}>
          <SiteLanguagesProvider value={site}>{children}</SiteLanguagesProvider>
          <CabinetCookieNotice policyHref={siteHref('/legal/privacy', locale, site.defaultLanguage)} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
