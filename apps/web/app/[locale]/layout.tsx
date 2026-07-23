import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { OrganizationJsonLd } from '@/components/seo/OrganizationJsonLd';
import { routing } from '@/i18n/routing';
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
      index: true,
      follow: true,
    },
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

  return (
    // suppressHydrationWarning: next-themes меняет data-theme до гидрации
    <html lang={locale} suppressHydrationWarning className={inter.variable}>
      <body className="bg-base font-sans text-primary">
        <OrganizationJsonLd />
        <NextIntlClientProvider messages={messages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
