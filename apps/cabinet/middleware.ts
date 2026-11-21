import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import {
  LOCALE_COOKIE,
  localeCookieDomain,
  stripLocalePrefix,
  type SiteLanguages,
} from '@broker/utils/locales';
import { routing } from './i18n/routing';
import { SESSION_COOKIE } from './lib/auth/constants';
import { legacyTarget } from './lib/legacy-routes';
import { applyAttributionCookies } from './lib/attribution-cookies';
import { homePathFor, isMailLinkPath, isPublicAuthPath, loginPathFor, safeTerminalNext } from './lib/auth/public-paths';
import { siteLanguagesForMiddleware } from './lib/site-languages-edge';

const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const handlers = new Map<string, ReturnType<typeof createMiddleware>>();

function intlFor(site: SiteLanguages): ReturnType<typeof createMiddleware> {
  const key = `${site.defaultLanguage}|${site.languages.join(',')}`;
  let handler = handlers.get(key);
  if (!handler) {
    handler = createMiddleware({ ...routing, locales: [...site.languages], defaultLocale: site.defaultLanguage });
    handlers.set(key, handler);
  }
  return handler;
}

function isDocumentRequest(request: NextRequest): boolean {
  const dest = request.headers.get('sec-fetch-dest');
  return (dest === null || dest === 'document') && !request.headers.has('rsc') && !request.headers.has('next-router-prefetch');
}

function withLocaleCookie(request: NextRequest, response: NextResponse, locale: string): NextResponse {
  if (!isDocumentRequest(request) || request.cookies.get(LOCALE_COOKIE)?.value === locale) return response;
  const domain = localeCookieDomain(process.env.LOCALE_COOKIE_DOMAIN, process.env.ATTRIBUTION_COOKIE_DOMAIN);
  response.cookies.set(LOCALE_COOKIE, locale, {
    sameSite: 'lax',
    secure: request.nextUrl.protocol === 'https:',
    path: '/',
    maxAge: LOCALE_COOKIE_MAX_AGE,
    ...(domain ? { domain } : {}),
  });
  return response;
}

/**
 * Гейт по НАЛИЧИЮ сессионной куки (в middleware нет БД — edge);
 * настоящая валидация сессии — в layout защищённой зоны. Языки — из карточки
 * сайта CMS: язык по умолчанию без префикса, невключённый язык — 404 до гейта
 * (lib/auth/public-paths.ts). Выбор языка — в cookie NEXT_LOCALE на общем
 * с витриной домене.
 */
export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const site = await siteLanguagesForMiddleware();
  const prefixed = stripLocalePrefix(pathname).locale;
  if (prefixed !== null && !(site.languages as readonly string[]).includes(prefixed)) {
    return NextResponse.next();
  }
  const locale = prefixed ?? site.defaultLanguage;
  const intl = (req: NextRequest) => withLocaleCookie(req, intlFor(site)(req), locale);

  const hasSessionCookie = request.cookies.has(SESSION_COOKIE);
  const isPublic = isPublicAuthPath(pathname);

  // Ссылки из писем (поддержка, 10.11): и гостю, и вошедшему.
  if (isMailLinkPath(pathname)) return intl(request);

  if (!hasSessionCookie && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = loginPathFor(pathname, site);
    url.search = '';
    const next = safeTerminalNext(`${pathname}${request.nextUrl.search}`);
    if (next) url.searchParams.set('next', next);
    return NextResponse.redirect(url);
  }

  if (hasSessionCookie && isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = homePathFor(pathname, site);
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
