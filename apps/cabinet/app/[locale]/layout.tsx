import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { hexToRgbChannels } from '@broker/utils';
import { routing } from '@/i18n/routing';
import { getChromeBrand, resolveBrandName } from '@/lib/chrome';
import { onAccentChannels } from '@/lib/on-accent';
import '../globals.css';

const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-sans',
  display: 'swap',
});

/**
 * `viewport-fit=cover` — чтобы `env(safe-area-inset-bottom)` работал: нижняя
 * навигация телефона отступает от жестовой полосы (аудит К2).
 */
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
  // Бренд — из CMS (строки бренда в коде нет, 10.11)
  const brand = resolveBrandName(await getChromeBrand(params.locale), tCommon('cabinet'));
  return {
    title: t('title', { brand }),
    description: t('description', { brand }),
    robots: { index: false, follow: false },
  };
}

export default async function RootLayout({ children, params }: LayoutProps) {
  const { locale } = params;
  if (!hasLocale(routing.locales, locale)) notFound();

  // Первой строкой — до любых проверок (урок B-007)
  setRequestLocale(locale);
  const messages = await getMessages();

  // Бренд из CMS (тот же тенант, что у сайта): акцент поверх токенов.
  // Цвет не задан (в v2 это штатное `null`) — остаёмся на палитре
  // токенов СОЗНАТЕЛЬНО: у кабинета нет витринной задачи держать
  // фирменный цвет, он за логином. Остальной бренд при этом на месте.
  const brand = await getChromeBrand(locale);
  const accentChannels = brand?.primaryColor ? hexToRgbChannels(brand.primaryColor) : null;
  // Акцент бренда приходит с текстом на нём: тёмный на светлом акценте,
  // белый на тёмном — primary-кнопка держит AA при любом цвете из CMS.
  const onAccent = accentChannels ? onAccentChannels(accentChannels) : null;

  return (
    <html lang={locale} data-theme="dark" className={inter.variable}>
      <body className="bg-base font-sans text-primary">
        {accentChannels && (
          <style>{`:root{--accent:${accentChannels};--text-on-accent:${onAccent};}`}</style>
        )}
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
