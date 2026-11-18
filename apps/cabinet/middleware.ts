import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from './i18n/routing';
import { SESSION_COOKIE } from './lib/auth/constants';
import { legacyTarget } from './lib/legacy-routes';
import { applyAttributionCookies } from './lib/attribution-cookies';
import { homePathFor, isMailLinkPath, isPublicAuthPath, loginPathFor } from './lib/auth/public-paths';

const intl = createMiddleware(routing);

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE);
  const isPublic = isPublicAuthPath(pathname);

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
