import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { isRateLimited } from '@/lib/rate-limit';
import { terminalLeverageFor } from '@/lib/leverage';
import { terminalFeesFor } from '@/lib/fees';
import {
  issueHandoffToken,
  isSsoConfigured,
  parseAccountKind,
  type AccountKind,
  tenantSlug,
  TokenWithoutExpiryError,
  type HandoffToken,
} from '@/lib/sso/jwt';

export const dynamic = 'force-dynamic';

function requestedAccountKind(request?: Request): AccountKind | null {
  if (!request) return 'demo';
  try {
    return parseAccountKind(new URL(request.url).searchParams.get('account'));
  } catch {
    return 'demo';
  }
}

export async function POST(request: Request) {
  const accountKind = requestedAccountKind(request);
  if (accountKind === null) {
    return NextResponse.json({ error: 'invalid_account_kind' }, { status: 400 });
  }
  if (!isSsoConfigured()) {
    return NextResponse.json({ error: 'sso_not_configured' }, { status: 503 });
  }
  let tenant: string;
  try {
    tenant = tenantSlug();
  } catch {
    console.error('[sso] SITE_SLUG не задан — токен не выпускаем (PKG-05)');
    return NextResponse.json({ error: 'tenant_not_configured' }, { status: 503 });
  }
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (user.mustChangePassword) {
    return NextResponse.json({ error: 'password_change_required' }, { status: 403 });
  }
  if (isRateLimited(`sso:${user.id}`, 30, 60_000)) {
    return NextResponse.json({ error: 'rateLimited' }, { status: 429 });
  }

  let leverage: Awaited<ReturnType<typeof terminalLeverageFor>>;
  try {
    leverage = await terminalLeverageFor(user.id);
  } catch (error) {
    console.error('[sso] плечо клиента не прочитано — токен не выпускаем (Р-446)', error);
    return NextResponse.json({ error: 'leverage_unavailable' }, { status: 503 });
  }

  let fees: { markupBps: number; commissionBps: number } | null = null;
  try {
    fees = await terminalFeesFor(user.id);
  } catch (error) {
    console.error('[sso] тариф клиента не прочитан — claim не кладём', error);
  }

  let handoff: HandoffToken;
  try {
    handoff = await issueHandoffToken(user.id, accountKind, leverage, fees);
  } catch (error) {
    if (error instanceof TokenWithoutExpiryError) {
      console.error(`[sso] ${error.message} — токен не отдаём (Р-100, CAB-07)`);
      return NextResponse.json({ error: 'token_without_expiry' }, { status: 503 });
    }
    throw error;
  }

  return NextResponse.json(
    { token: handoff.token, tenant, expiresIn: handoff.expiresIn, accountKind },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
