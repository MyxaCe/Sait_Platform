import type { NextRequest, NextResponse } from 'next/server';
import { ATTRIBUTION_COOKIES, cookiesForClick } from '@broker/promo/attribution';

/**
 * First-click cookie атрибуции по `?ref=` / `?promo=` (edge, без базы).
 * Срок кабинет здесь не знает — cookie сессионная, а действующий срок
 * (настройки платформы) проверяет регистрация по метке времени в значении.
 * Действующую cookie (например, поставленную витриной на общий домен) не
 * перезаписываем. Домен — `ATTRIBUTION_COOKIE_DOMAIN` (напр. `.wholesalefy.com`),
 * не задан — cookie хоста.
 */
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
