import { envOr } from '@broker/utils';

const CABINET_URL = envOr(process.env.NEXT_PUBLIC_CABINET_URL, 'http://localhost:3002').replace(/\/$/, '');

export function cabinetRegisterHref(href: string, locale: string): string {
  if (!href.startsWith('/register')) return href;
  const rest = href.slice('/register'.length);
  if (rest !== '' && !rest.startsWith('?') && !rest.startsWith('#')) return href;
  return `${CABINET_URL}${locale === 'en' ? '/en' : ''}/register${rest}`;
}
