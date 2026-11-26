import { pageLocale } from '@/lib/locale';
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { draftMode } from 'next/headers';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { ContentAutoRefresh } from '@/components/ContentAutoRefresh';
import { PreviewBanner } from '@/components/PreviewBanner';
import { SiteCookieNotice } from '@/components/layout/SiteCookieNotice';
import { OrganizationJsonLd } from '@/components/seo/OrganizationJsonLd';
import { OPEN_GRAPH_LOCALES, type PlatformLocale } from '@broker/utils/locales';
import { SiteLanguagesProvider } from '@/i18n/site-languages-context';
import { brandAccentCss } from '@broker/utils';
import { resolvePrimaryColor } from '@/lib/brand';
import { getCms, isCmsConfigured } from '@/lib/cms';
import { getSiteLanguages } from '@/lib/site-languages';
import { SITE_URL } from '@/lib/site';
import { Providers } from './providers';
import '../globals.css';

const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-sans',
  display: 'swap',
});

interface LayoutProps {
  children: React.ReactNode;
  params: { locale: string };
}

export async function generateStaticParams() {
  if (!isCmsConfigured()) return [];
  const { languages } = await getSiteLanguages();
  return languages.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'meta' });

  let draft = false;
  try {
    draft = draftMode().isEnabled;
  } catch {
    draft = false;
  }

  const brand = await getCms('brand', { locale: pageLocale(params.locale) });
  const title = t('title', { brand: brand.name });

  return {
    ...(brand.favicon
      ? {
          icons: {
            icon: [
              {
                url: brand.favicon.url,
                sizes: `${brand.favicon.width}x${brand.favicon.height}`,
                type: brand.favicon.mimeType,
              },
            ],
          },
        }
      : {}),
    metadataBase: new URL(SITE_URL),
    title: {
      default: title,
      template: `%s — ${brand.name}`,
    },
    description: t('description'),
    applicationName: brand.name,
    openGraph: {
      type: 'website',
      siteName: brand.name,
      locale: OPEN_GRAPH_LOCALES[pageLocale(params.locale)],
      url: SITE_URL,
      title,
      description: t('description'),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: t('description'),
    },
    robots: {
      index: !draft,
      follow: !draft,
    },
    other: { 'rendered-at': new Date().toISOString() },
    appleWebApp: {
      capable: true,
      title: brand.name,
      statusBarStyle: 'black-translucent',
    },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#08090c' },
    { media: '(prefers-color-scheme: light)', color: '#f7f8fa' },
  ],
};

export default async function RootLayout({ children, params }: LayoutProps) {
  const { locale } = params;
  const site = await getSiteLanguages();
  if (!(site.languages as readonly string[]).includes(locale)) notFound();

  setRequestLocale(locale);
  const messages = await getMessages();

  const brand = await getCms('brand', { locale: locale as PlatformLocale });
  const primary = resolvePrimaryColor(brand.primaryColor);
  const accentCss = brandAccentCss(primary.color);
  const tMeta = await getTranslations({ locale, namespace: 'meta' });

  let isDraft = false;
  try {
    isDraft = draftMode().isEnabled;
  } catch {
    isDraft = false;
  }

  return (
    <html lang={locale} suppressHydrationWarning className={inter.variable}>
      <body className="bg-base font-sans text-primary" data-brand-color={primary.source}>
        {accentCss && <style>{accentCss}</style>}
        <OrganizationJsonLd
          name={brand.name}
          description={tMeta('description')}
          logoUrl={brand.logo?.url ?? null}
          legalEntity={brand.legalEntity}
          socials={brand.socials}
          languages={site.languages}
        />
        <NextIntlClientProvider messages={messages}>
          <SiteLanguagesProvider value={site}>
            <Providers>{children}</Providers>
            <SiteCookieNotice />
          </SiteLanguagesProvider>
        </NextIntlClientProvider>
        <ContentAutoRefresh disabled={isDraft} />
        <PreviewBanner locale={locale} />
      </body>
    </html>
  );
}
