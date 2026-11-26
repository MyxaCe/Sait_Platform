import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { localeHref } from '@/i18n/redirect';
import { SESSION_COOKIE } from '@/lib/auth/constants';
import { loginAfterExpiry } from '@/lib/auth/expired';
import { safeNext } from '@/lib/auth/next-path';
import { clearSessionHint } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/** Стирает погашенную cookie сессии и ведёт на вход (см. lib/auth/expired.ts). */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const locale = request.nextUrl.searchParams.get('locale') ?? '';
  const next = safeNext(request.nextUrl.searchParams.get('next'));
  const login = loginAfterExpiry(await localeHref('/login', locale), next);
  cookies().delete(SESSION_COOKIE);
  clearSessionHint();
  return NextResponse.redirect(new URL(login, request.url), 303);
}
