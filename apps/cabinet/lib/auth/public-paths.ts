import { routing, type Locale } from '@/i18n/routing';

/**
 * Классификация путей кабинета для middleware (edge, без node-зависимостей).
 *
 * Путь может прийти с префиксом ЛЮБОЙ локали: `localePrefix: 'as-needed'`
 * прячет префикс языка по умолчанию, но `/ru/…` — валидный адрес (ссылки из
 * писем, ручной ввод, переключатель языка), next-intl сам сведёт его к `/…`.
 * Раньше регулярка знала только `/en`: `/ru/forgot-password` без сессии
 * уводил на /login — восстановить пароль по такой ссылке было нельзя.
 */
const LOCALES: readonly Locale[] = routing.locales;
const DEFAULT_LOCALE: Locale = routing.defaultLocale;
const PREFIX = `(?:(?:${LOCALES.join('|')})/)?`;

/** Вход/регистрация/восстановление: гостю — можно, вошедшему — уводим внутрь. */
const PUBLIC_PATH = new RegExp(`^/${PREFIX}(?:login|register|forgot-password)(?:/|$)`);
/** Ссылки из писем: открываются и гостем, и вошедшим (сброс пароля, email). */
const MAIL_LINK_PATH = new RegExp(`^/${PREFIX}(?:reset-password|verify-email)(?:/|$)`);

export function isPublicAuthPath(pathname: string): boolean {
  return PUBLIC_PATH.test(pathname);
}

export function isMailLinkPath(pathname: string): boolean {
  return MAIL_LINK_PATH.test(pathname);
}

/** Локаль из префикса пути (`/en`, `/en/…`, `/ru/…`); без префикса — по умолчанию. */
export function localeOfPath(pathname: string): Locale {
  for (const l of LOCALES) {
    if (pathname === `/${l}` || pathname.startsWith(`/${l}/`)) return l;
  }
  return DEFAULT_LOCALE;
}

/** Куда вести гостя: вход на языке пути (язык по умолчанию — без префикса). */
export function loginPathFor(pathname: string): string {
  const l = localeOfPath(pathname);
  return l === DEFAULT_LOCALE ? '/login' : `/${l}/login`;
}

/** Куда вести вошедшего со страницы входа: главная на языке пути. */
export function homePathFor(pathname: string): string {
  const l = localeOfPath(pathname);
  return l === DEFAULT_LOCALE ? '/' : `/${l}`;
}
