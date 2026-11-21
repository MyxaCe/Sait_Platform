import { envOr } from '@broker/utils';
import { localizedPath } from '@broker/utils/locales';

/**
 * Открытие счёта живёт в КАБИНЕТЕ (ADR-022): регистрация там открывает счёт.
 * Прежде CTA акций и «Открыть счёт» вели на `/register` витрины — форму
 * ЛИДА, которая счёт не открывает, и параметр `?promo=` терялся (аудит
 * «ДЕМО-акции» §1.2). Теперь любая ссылка `/register…` уводится на
 * регистрацию кабинета с сохранением query (`promo`, `ref`, `account`, `demo`).
 *
 * Пустая строка — не отсутствие (WEB-21), как в шапке.
 */
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
