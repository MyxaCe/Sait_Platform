import {
  COMPAT_SITE_LANGUAGES,
  PLATFORM_LOCALES,
  localizedPath,
  stripLocalePrefix,
  type PlatformLocale,
  type SiteLanguages,
} from '@broker/utils/locales';

const PREFIX = `(?:(?:${PLATFORM_LOCALES.join('|')})/)?`;

const PUBLIC_PATH = new RegExp(`^/${PREFIX}(?:login|register|forgot-password)(?:/|$)`);
const MAIL_LINK_PATH = new RegExp(`^/${PREFIX}(?:reset-password|verify-email)(?:/|$)`);

export function isPublicAuthPath(pathname: string): boolean {
  return PUBLIC_PATH.test(pathname);
}

export function isMailLinkPath(pathname: string): boolean {
  return MAIL_LINK_PATH.test(pathname);
}

export function localeOfPath(pathname: string, site: SiteLanguages = COMPAT_SITE_LANGUAGES): PlatformLocale {
  return stripLocalePrefix(pathname).locale ?? site.defaultLanguage;
}

export function loginPathFor(pathname: string, site: SiteLanguages = COMPAT_SITE_LANGUAGES): string {
  return localizedPath('/login', localeOfPath(pathname, site), site.defaultLanguage);
}

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
