import { envOr } from '@broker/utils';

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

export function cabinetRegisterHref(href: string, locale: string): string {
  if (!href.startsWith('/register')) return href;
  const rest = href.slice('/register'.length);
  if (rest !== '' && !rest.startsWith('?') && !rest.startsWith('#')) return href;
  return `${CABINET_URL}${locale === 'en' ? '/en' : ''}/register${rest}`;
}
