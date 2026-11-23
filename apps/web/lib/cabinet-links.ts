import { envOr } from '@broker/utils';
import { localizedPath } from '@broker/utils/locales';

const CABINET_URL = envOr(process.env.NEXT_PUBLIC_CABINET_URL, 'http://localhost:3002').replace(/\/$/, '');

export function cabinetRegisterHref(href: string, locale: string, defaultLanguage = 'ru'): string {
  if (!href.startsWith('/register')) return href;
  const rest = href.slice('/register'.length);
  if (rest !== '' && !rest.startsWith('?') && !rest.startsWith('#')) return href;
  return `${CABINET_URL}${localizedPath(`/register${rest}`, locale, defaultLanguage)}`;
}

export function cabinetLoginHref(locale: string, defaultLanguage = 'ru'): string {
  return `${CABINET_URL}${localizedPath('/login', locale, defaultLanguage)}`;
}

type Query = Record<string, string | string[] | undefined>;

/**
 * Адрес регистрации кабинета для старых ссылок витрины `/register?…`.
 * Старая форма принимала тариф как `account`, кабинет — как `accountType`.
 */
export function cabinetRegisterRedirect(query: Query | undefined, locale: string, defaultLanguage = 'ru'): string {
  const params = new URLSearchParams();
  for (const [key, raw] of Object.entries(query ?? {})) {
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value === undefined || value === '') continue;
    const name = key === 'account' ? 'accountType' : key;
    if (name === 'accountType' && params.has('accountType')) continue;
    params.set(name, value);
  }
  const search = params.toString();
  return cabinetRegisterHref(search ? `/register?${search}` : '/register', locale, defaultLanguage);
}

export type TerminalAccount = 'real' | 'demo';

export function cabinetTerminalHref(
  account: TerminalAccount,
  symbol: string,
  locale: string,
  defaultLanguage = 'ru',
): string {
  const query = new URLSearchParams({ account, symbol: symbol.toUpperCase() });
  return `${CABINET_URL}${localizedPath(`/terminal?${query.toString()}`, locale, defaultLanguage)}`;
}
