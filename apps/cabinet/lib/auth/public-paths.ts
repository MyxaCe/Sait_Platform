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

const TERMINAL_PATH = new RegExp(`^/${PREFIX}terminal$`);
const TERMINAL_ACCOUNT = /^(demo|real)$/;
const TERMINAL_SYMBOL = /^[A-Z0-9]{1,20}$/;

export function parseTerminalSymbol(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const symbol = raw.trim().toUpperCase();
  return TERMINAL_SYMBOL.test(symbol) ? symbol : null;
}

export function safeTerminalNext(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
  let url: URL;
  try {
    url = new URL(raw, 'http://cabinet.invalid');
  } catch {
    return null;
  }
  if (url.origin !== 'http://cabinet.invalid' || !TERMINAL_PATH.test(url.pathname)) return null;
  const query = new URLSearchParams();
  const account = url.searchParams.get('account');
  if (account && TERMINAL_ACCOUNT.test(account)) query.set('account', account);
  const symbol = parseTerminalSymbol(url.searchParams.get('symbol'));
  if (symbol) query.set('symbol', symbol);
  const search = query.toString();
  return search ? `${url.pathname}?${search}` : url.pathname;
}
