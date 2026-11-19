import { defineRouting } from 'next-intl/routing';
import { PLATFORM_LOCALES } from '@broker/utils/locales';

export const routing = defineRouting({
  locales: PLATFORM_LOCALES,
  defaultLocale: 'ru',
  localePrefix: 'as-needed',
  localeDetection: false,
  localeCookie: false,
  alternateLinks: false,
});

export type Locale = (typeof routing.locales)[number];
