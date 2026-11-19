import {
  COMPAT_SITE_LANGUAGES,
  PLATFORM_LOCALES,
  localizedPath,
  stripLocalePrefix,
  type PlatformLocale,
  type SiteLanguages,
} from '@broker/utils/locales';

/**
 * Классификация путей кабинета для middleware (edge, без node-зависимостей).
 *
 * Путь может прийти с префиксом ЛЮБОЙ локали платформы: язык сайта по
 * умолчанию идёт без префикса, но `/ru/…` — тоже валидный адрес (ссылки из
 * писем, ручной ввод, переключатель языка), next-intl сам сведёт его к `/…`.
 * Раньше регулярка знала только `/en`: `/ru/forgot-password` без сессии
 * уводил на /login — восстановить пароль по такой ссылке было нельзя.
 * Включён ли язык для сайта, решает middleware (невключённый — 404) до гейта.
 */
const PREFIX = `(?:(?:${PLATFORM_LOCALES.join('|')})/)?`;

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

/** Локаль из префикса пути (`/en`, `/de/…`, `/ru/…`); без префикса — язык сайта по умолчанию. */
export function localeOfPath(pathname: string, site: SiteLanguages = COMPAT_SITE_LANGUAGES): PlatformLocale {
  return stripLocalePrefix(pathname).locale ?? site.defaultLanguage;
}

/** Куда вести гостя: вход на языке пути (язык по умолчанию — без префикса). */
export function loginPathFor(pathname: string, site: SiteLanguages = COMPAT_SITE_LANGUAGES): string {
  return localizedPath('/login', localeOfPath(pathname, site), site.defaultLanguage);
}

/** Куда вести вошедшего со страницы входа: главная на языке пути. */
export function homePathFor(pathname: string, site: SiteLanguages = COMPAT_SITE_LANGUAGES): string {
  return localizedPath('/', localeOfPath(pathname, site), site.defaultLanguage);
}
