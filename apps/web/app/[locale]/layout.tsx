import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { draftMode } from 'next/headers';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { ContentAutoRefresh } from '@/components/ContentAutoRefresh';
import { PreviewBanner } from '@/components/PreviewBanner';
import { OrganizationJsonLd } from '@/components/seo/OrganizationJsonLd';
import { routing } from '@/i18n/routing';
import { hexToRgbChannels, resolvePrimaryColor } from '@/lib/brand';
import { getCms, isCmsConfigured } from '@/lib/cms';
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

/**
 * Пререндер на сборке — только если сборке доступна CMS.
 *
 * В CI образ собирается без CMS. Прежде страницы пререндерились из
 * фикстур кода, и стенд час после каждого деплоя показывал код вместо
 * CMS (аудит 10.11). Теперь без CMS список пуст: страницы собираются
 * при первом запросе (on-demand ISR, `dynamicParams` по умолчанию true)
 * из CMS или из последней сохранённой версии её ответа.
 */
export function generateStaticParams() {
  return isCmsConfigured() ? routing.locales.map((locale) => ({ locale })) : [];
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

  // Бренд из CMS (White Label): имя — в title/OG/applicationName,
  // favicon — если загружен, переопределяет статический. Имени в коде нет.
  const brand = await getCms('brand', {
    locale: params.locale === 'en' ? 'en' : 'ru',
  });
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
      locale: params.locale === 'en' ? 'en_US' : 'ru_RU',
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
    // Возраст контента (ADR-020): по этой метке синтетический монитор
    // проверяет цикл «правка → вебхук → обновление страницы»
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
  if (!hasLocale(routing.locales, locale)) notFound();

  // Обязательно для статического рендеринга страниц с переводами
  setRequestLocale(locale);
  const messages = await getMessages();

  // Бренд из CMS (тег cms:brand): акцентный цвет инжектируется поверх
  // токенов. Цвета в CMS нет (`null` в v2) — действует токен `--accent`:
  // запасного цвета бренда в коде нет (10.11).
  const brand = await getCms('brand', { locale: locale as 'ru' | 'en' });
  const primary = resolvePrimaryColor(brand.primaryColor);
  const accentChannels = primary.color ? hexToRgbChannels(primary.color) : null;
  const tMeta = await getTranslations({ locale, namespace: 'meta' });

  // В preview страница динамическая, rendered-at меняется на каждый запрос —
  // автообновление там не имеет смысла (тот же try/catch, что в generateMetadata)
  let isDraft = false;
  try {
    isDraft = draftMode().isEnabled;
  } catch {
    isDraft = false;
  }

  return (
    // suppressHydrationWarning: next-themes меняет data-theme до гидрации
    <html lang={locale} suppressHydrationWarning className={inter.variable}>
      <body className="bg-base font-sans text-primary" data-brand-color={primary.source}>
        {accentChannels && (
          <style>{`:root{--accent:${accentChannels};}`}</style>
        )}
        <OrganizationJsonLd
          name={brand.name}
          description={tMeta('description')}
          logoUrl={brand.logo?.url ?? null}
        />
        <NextIntlClientProvider messages={messages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
        <ContentAutoRefresh disabled={isDraft} />
        <PreviewBanner locale={locale} />
      </body>
    </html>
  );
}
