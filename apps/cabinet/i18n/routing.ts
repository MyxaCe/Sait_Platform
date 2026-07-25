import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['ru', 'en'],
  defaultLocale: 'ru',
  localePrefix: 'as-needed',
  // Как на сайте (B-005): язык только URL и переключателем
  localeDetection: false,
});

export type Locale = (typeof routing.locales)[number];
