import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Apex Capital — торговля на мировых рынках',
    short_name: 'Apex Capital',
    description:
      '12 000+ торговых инструментов: Forex, акции, криптовалюты, индексы и металлы. Котировки в реальном времени.',
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#08090c',
    theme_color: '#08090c',
    lang: 'ru',
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
      { name: 'Котировки', url: '/instruments' },
      { name: 'Новости рынка', url: '/analytics/news' },
      { name: 'Открыть счёт', url: '/register' },
    ],
  };
}
