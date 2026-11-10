import type { MetadataRoute } from 'next';
import { getTranslations } from 'next-intl/server';
import { getCms } from '@/lib/cms';

/**
 * PWA-манифест. Имя — из CMS (`cms:brand`), в коде бренда нет (10.11);
 * подзаголовок и описание — SEO-тексты `messages.meta` (до CMS v2, где
 * манифест — `design/seo/manifest.ts`). Цвета — дизайн (токены фона).
 *
 * Динамический: на сборке CMS нет, а пререндер из ничего запёк бы
 * манифест без имени. Ответ CMS кешируется на её стороне запроса.
 */
export const dynamic = 'force-dynamic';

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const locale = 'ru';
  const brand = await getCms('brand', { locale });
  const tMeta = await getTranslations({ locale, namespace: 'meta' });
  const tShortcuts = await getTranslations({ locale, namespace: 'pwaShortcuts' });

  return {
    id: '/',
    name: tMeta('title', { brand: brand.name }),
    short_name: brand.name,
    description: tMeta('description'),
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#08090c',
    theme_color: '#08090c',
    lang: locale,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      { name: tShortcuts('quotes'), url: '/instruments' },
      { name: tShortcuts('news'), url: '/analytics/news' },
      { name: tShortcuts('register'), url: '/register' },
    ],
  };
}
