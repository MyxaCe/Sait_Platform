import { envOr } from '@broker/utils';
import { localizedPath } from '@broker/utils/locales';

const CABINET_URL = envOr(process.env.NEXT_PUBLIC_CABINET_URL, 'http://localhost:3002').replace(/\/$/, '');

export function cabinetRegisterHref(href: string, locale: string, defaultLanguage = 'ru'): string {
  if (!href.startsWith('/register')) return href;
  const rest = href.slice('/register'.length);
  if (rest !== '' && !rest.startsWith('?') && !rest.startsWith('#')) return href;
  return `${CABINET_URL}${localizedPath(`/register${rest}`, locale, defaultLanguage)}`;
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
