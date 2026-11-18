import type { NextRequest, NextResponse } from 'next/server';
import { ATTRIBUTION_COOKIES, cookiesForClick } from '@broker/promo/attribution';

export function applyAttributionCookies(request: NextRequest, response: NextResponse): NextResponse {
  const params = request.nextUrl.searchParams;
  const ref = params.get('ref');
  const promo = params.get('promo');
  if (!ref && !promo) return response;
  const domain = process.env.ATTRIBUTION_COOKIE_DOMAIN?.trim() || undefined;
  for (const c of cookiesForClick({
    params: { ref, promo },
    existing: {
      ref: request.cookies.get(ATTRIBUTION_COOKIES.ref)?.value ?? null,
      promo: request.cookies.get(ATTRIBUTION_COOKIES.promo)?.value ?? null,
    },
    now: new Date(),
    windowDays: null,
  })) {
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
