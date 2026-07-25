import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { hexToRgbChannels } from '@broker/utils';
import { routing } from '@/i18n/routing';
import { getChromeBrand } from '@/lib/chrome';
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

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'meta' });
  return {
    title: t('title'),
    description: t('description'),
    robots: { index: false, follow: false },
  };
}

export default async function RootLayout({ children, params }: LayoutProps) {
  const { locale } = params;
  if (!hasLocale(routing.locales, locale)) notFound();

  // Первой строкой — до любых проверок (урок B-007)
  setRequestLocale(locale);
  const messages = await getMessages();

  // Бренд из CMS (тот же тенант, что у сайта): акцент поверх токенов
  const brand = await getChromeBrand(locale);
  const accentChannels = brand ? hexToRgbChannels(brand.primaryColor) : null;

  return (
    <html lang={locale} data-theme="dark" className={inter.variable}>
      <body className="bg-base font-sans text-primary">
        {accentChannels && <style>{`:root{--accent:${accentChannels};}`}</style>}
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
