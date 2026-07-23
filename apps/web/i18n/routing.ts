import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['ru', 'en'],
  defaultLocale: 'ru',
  // Русский — без префикса (/instruments), английский — /en/instruments
  localePrefix: 'as-needed',
  // Язык выбирается только URL и переключателем: без автодетекции по
  // Accept-Language/cookie — предсказуемые URL для SEO и пользователей
  localeDetection: false,
});

export type Locale = (typeof routing.locales)[number];
