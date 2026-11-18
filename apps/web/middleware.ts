import createMiddleware from 'next-intl/middleware';
import type { NextRequest } from 'next/server';
import { ATTRIBUTION_COOKIES, cookiesForClick } from '@broker/promo/attribution';
import { routing } from './i18n/routing';
import { attributionWindowDays } from './lib/attribution-config';

const intl = createMiddleware(routing);

export default async function middleware(request: NextRequest) {
  const response = intl(request);
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
      secure: request.nextUrl.protocol === 'https:',
      path: '/',
      ...(domain ? { domain } : {}),
      ...(c.maxAge !== null ? { maxAge: c.maxAge } : {}),
    });
  }
  return response;
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
