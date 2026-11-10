import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from './i18n/routing';
import { SESSION_COOKIE } from './lib/auth/constants';
import { legacyTarget } from './lib/legacy-routes';
import { applyAttributionCookies } from './lib/attribution-cookies';
import { homePathFor, isMailLinkPath, isPublicAuthPath, loginPathFor } from './lib/auth/public-paths';

const intl = createMiddleware(routing);

/**
 * Гейт по НАЛИЧИЮ сессионной куки (в middleware нет БД — edge);
 * настоящая валидация сессии — в layout защищённой зоны. Пути — с префиксом
 * любой локали (`/ru/…`, `/en/…`) или без него (lib/auth/public-paths.ts).
 */
export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE);
  const isPublic = isPublicAuthPath(pathname);

  // Ссылки из писем (поддержка, 10.11): и гостю, и вошедшему.
  if (isMailLinkPath(pathname)) return intl(request);

  if (!hasSessionCookie && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = loginPathFor(pathname);
    url.search = '';
    return NextResponse.redirect(url);
  }

  if (hasSessionCookie && isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = homePathFor(pathname);
    url.search = '';
    return NextResponse.redirect(url);
  }

  // Регистрация по ссылке акции / реф-ссылке: first-click cookie (атрибуция).
  if (isPublic) {
    return applyAttributionCookies(request, intl(request));
  }

  const legacy = legacyTarget(pathname, request.nextUrl.search);
  if (legacy) {
    return NextResponse.redirect(new URL(legacy, request.url), 307);
  }

  return intl(request);
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
