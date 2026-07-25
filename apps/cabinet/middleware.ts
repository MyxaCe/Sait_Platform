import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from './i18n/routing';
import { SESSION_COOKIE } from './lib/auth/constants';

const intl = createMiddleware(routing);

/** Публичные маршруты кабинета (с учётом /en-префикса) */
const PUBLIC_PATH = /^\/(en\/?)?(login|register)(\/|$)/;

/**
 * Гейт по НАЛИЧИЮ сессионной куки (в middleware нет БД — edge);
 * настоящая валидация сессии — в layout защищённой зоны.
 */
export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE);
  const isPublic = PUBLIC_PATH.test(pathname) || pathname === '/en';

  if (!hasSessionCookie && !PUBLIC_PATH.test(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = pathname === '/en' || pathname.startsWith('/en/') ? '/en/login' : '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  if (hasSessionCookie && PUBLIC_PATH.test(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.startsWith('/en') ? '/en' : '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return intl(request);
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
