import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { isRateLimited } from '@/lib/rate-limit';
import { issueHandoffToken, isSsoConfigured, SSO_TOKEN_TTL_SECONDS, tenantSlug } from '@/lib/sso/jwt';

/**
 * Выпуск handoff-JWT для терминала. Только для живой сессии кабинета —
 * это и есть весь механизм «выход в кабинете = выход в терминале»:
 * погашенная сессия не может переотдать токен, терминал разлогинивается
 * не позднее своего TTL (≤15 мин).
 */
export const dynamic = 'force-dynamic';

export async function POST() {
  if (!isSsoConfigured()) {
    return NextResponse.json({ error: 'sso_not_configured' }, { status: 503 });
  }
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (isRateLimited(`sso:${user.id}`, 30, 60_000)) {
    return NextResponse.json({ error: 'rateLimited' }, { status: 429 });
  }

  const token = await issueHandoffToken(user.id);
  return NextResponse.json(
    { token, tenant: tenantSlug(), expiresIn: SSO_TOKEN_TTL_SECONDS },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
