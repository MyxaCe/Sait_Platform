import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { ATTRIBUTION_COOKIES, cookiesForClick } from '@broker/promo/attribution';
import {
  LOCALE_COOKIE,
  localeCookieDomain,
  stripLocalePrefix,
  type SiteLanguages,
} from '@broker/utils/locales';
import { routing } from './i18n/routing';
import { attributionWindowDays } from './lib/attribution-config';
import { siteLanguagesForMiddleware } from './lib/site-languages-edge';

const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const handlers = new Map<string, ReturnType<typeof createMiddleware>>();

function intlFor(site: SiteLanguages): ReturnType<typeof createMiddleware> {
  const key = `${site.defaultLanguage}|${site.languages.join(',')}`;
  let handler = handlers.get(key);
  if (!handler) {
    handler = createMiddleware({
      ...routing,
      locales: [...site.languages],
      defaultLocale: site.defaultLanguage,
      alternateLinks: true,
    });
    handlers.set(key, handler);
  }
  return handler;
}

function isDocumentRequest(request: NextRequest): boolean {
  const dest = request.headers.get('sec-fetch-dest');
  return (dest === null || dest === 'document') && !request.headers.has('rsc') && !request.headers.has('next-router-prefetch');
}

export default async function middleware(request: NextRequest) {
  const site = await siteLanguagesForMiddleware();
  const prefixed = stripLocalePrefix(request.nextUrl.pathname).locale;
  const enabled = prefixed === null || (site.languages as readonly string[]).includes(prefixed);
  const response = enabled ? intlFor(site)(request) : NextResponse.next();
  const secure = request.nextUrl.protocol === 'https:';

  const locale = prefixed ?? site.defaultLanguage;
  if (enabled && isDocumentRequest(request) && request.cookies.get(LOCALE_COOKIE)?.value !== locale) {
    const domain = localeCookieDomain(process.env.LOCALE_COOKIE_DOMAIN, process.env.ATTRIBUTION_COOKIE_DOMAIN);
    response.cookies.set(LOCALE_COOKIE, locale, {
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: LOCALE_COOKIE_MAX_AGE,
      ...(domain ? { domain } : {}),
    });
  }

  const params = request.nextUrl.searchParams;
  const ref = params.get('ref');
  const promo = params.get('promo');
  if (!ref && !promo) return response;

  const toSet = cookiesForClick({
    params: { ref, promo },
    existing: {
      ref: request.cookies.get(ATTRIBUTION_COOKIES.ref)?.value ?? null,
      promo: request.cookies.get(ATTRIBUTION_COOKIES.promo)?.value ?? null,
    },
    now: new Date(),
    windowDays: await attributionWindowDays(),
  });
  const domain = process.env.ATTRIBUTION_COOKIE_DOMAIN?.trim() || undefined;
  for (const c of toSet) {
    response.cookies.set(c.name, c.value, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      ...(domain ? { domain } : {}),
      ...(c.maxAge !== null ? { maxAge: c.maxAge } : {}),
    });
  }
  return response;
}

export const config = {
  matcher: ['/((?!api|media|_next|_vercel|.*\\..*).*)'],
};
