import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { draftMode } from 'next/headers';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { PreviewBanner } from '@/components/PreviewBanner';
import { OrganizationJsonLd } from '@/components/seo/OrganizationJsonLd';
import { routing } from '@/i18n/routing';
import { hexToRgbChannels } from '@/lib/brand';
import { getCms } from '@/lib/cms';
import { SITE_NAME, SITE_URL } from '@/lib/site';
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

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'meta' });

  // Черновики не индексируются (риск R-09)
  let draft = false;
  try {
    draft = draftMode().isEnabled;
  } catch {
    draft = false;
  }

  return {
    metadataBase: new URL(SITE_URL),
    title: {
      default: t('title'),
      template: `%s — ${SITE_NAME}`,
    },
    description: t('description'),
    applicationName: SITE_NAME,
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      locale: params.locale === 'en' ? 'en_US' : 'ru_RU',
      url: SITE_URL,
      title: t('title'),
      description: t('description'),
    },
    twitter: {
      card: 'summary_large_image',
      title: t('title'),
      description: t('description'),
    },
    robots: {
      index: !draft,
      follow: !draft,
    },
    // Возраст контента (ADR-020): по этой метке синтетический монитор
    // проверяет цикл «правка → вебхук → обновление страницы»
    other: { 'rendered-at': new Date().toISOString() },
    appleWebApp: {
      capable: true,
      title: SITE_NAME,
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
  if (!hasLocale(routing.locales, locale)) notFound();

  // Обязательно для статического рендеринга страниц с переводами
  setRequestLocale(locale);
  const messages = await getMessages();

  // Бренд из CMS (тег cms:brand): акцентный цвет инжектируется поверх токенов
  const brand = await getCms('brand', { locale: locale as 'ru' | 'en' });
  const accentChannels = hexToRgbChannels(brand.primaryColor);

  return (
    // suppressHydrationWarning: next-themes меняет data-theme до гидрации
    <html lang={locale} suppressHydrationWarning className={inter.variable}>
      <body className="bg-base font-sans text-primary">
        {accentChannels && (
          <style>{`:root{--accent:${accentChannels};}`}</style>
        )}
        <OrganizationJsonLd />
        <NextIntlClientProvider messages={messages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
        <PreviewBanner locale={locale} />
      </body>
    </html>
  );
}
