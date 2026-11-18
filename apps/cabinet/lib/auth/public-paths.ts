import { routing, type Locale } from '@/i18n/routing';

const LOCALES: readonly Locale[] = routing.locales;
const DEFAULT_LOCALE: Locale = routing.defaultLocale;
const PREFIX = `(?:(?:${LOCALES.join('|')})/)?`;

const PUBLIC_PATH = new RegExp(`^/${PREFIX}(?:login|register|forgot-password)(?:/|$)`);
const MAIL_LINK_PATH = new RegExp(`^/${PREFIX}(?:reset-password|verify-email)(?:/|$)`);

export function isPublicAuthPath(pathname: string): boolean {
  return PUBLIC_PATH.test(pathname);
}

export function isMailLinkPath(pathname: string): boolean {
  return MAIL_LINK_PATH.test(pathname);
}

export function localeOfPath(pathname: string): Locale {
  for (const l of LOCALES) {
    if (pathname === `/${l}` || pathname.startsWith(`/${l}/`)) return l;
  }
  return DEFAULT_LOCALE;
}

export function loginPathFor(pathname: string): string {
  const l = localeOfPath(pathname);
  return l === DEFAULT_LOCALE ? '/login' : `/${l}/login`;
}

export function homePathFor(pathname: string): string {
  const l = localeOfPath(pathname);
  return l === DEFAULT_LOCALE ? '/' : `/${l}`;
}
