import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['ru', 'en'],
  defaultLocale: 'ru',
  localePrefix: 'as-needed',
  localeDetection: false,
});

export type Locale = (typeof routing.locales)[number];
