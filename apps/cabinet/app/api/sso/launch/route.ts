import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { isRateLimited } from '@/lib/rate-limit';
import { terminalLeverageFor } from '@/lib/leverage';
import { terminalFeesFor } from '@/lib/fees';
import {
  issueHandoffToken,
  isSsoConfigured,
  parseAccountKind,
  tenantSlug,
  TokenWithoutExpiryError,
  type HandoffToken,
} from '@/lib/sso/jwt';
import { checkReturnUrl, launchLocation, parseLang, terminalOrigins } from '@/lib/sso/launch';

/**
 * Вход в терминал ВЕРХНИМ уровнем (sso-pack v1.1): кабинет выпускает тот же
 * handoff-JWT, что `POST /api/sso/token`, и отвечает
 * `302 → <return>#handoff=<jwt>&account=<kind>[&lang=…]`. Терминал зовёт
 * этот адрес и для продления сессии, и после перезагрузки страницы.
 *
 * Барьеры (в этом порядке):
 *  1. `account` — demo|real (иначе 400); `return` — только origin из белого
 *     списка терминала, точное совпадение (иначе 400; открытого редиректа нет);
 *  2. SSO/тенант настроены (иначе 503 — как у `/api/sso/token`);
 *  3. живая сессия незаблокированного клиента — иначе на логин кабинета с
 *     продолжением в этот же launch (блок → сессии нет → токена нет);
 *  4. rate limit — общий с `/api/sso/token` (`sso:<userId>`);
 *  5. плечо прочитано (fail-closed, Р-446); тариф — мягко, как в token.
 *
 * Токен — ТОЛЬКО во фрагменте (не уходит на сервер, в логи прокси, в Referer);
 * ответ `Cache-Control: no-store`.
 */
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

function deny(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const accountKind = parseAccountKind(url.searchParams.get('account') ?? 'demo');
  if (accountKind === null) return deny('invalid_account_kind', 400);

  const returnUrl = checkReturnUrl(url.searchParams.get('return'), terminalOrigins());
  if (returnUrl === null) return deny('invalid_return', 400);

  if (!isSsoConfigured()) return deny('sso_not_configured', 503);
  try {
    tenantSlug();
  } catch {
    console.error('[sso-launch] SITE_SLUG не задан — токен не выпускаем (PKG-05)');
    return deny('tenant_not_configured', 503);
  }

  const user = await getSessionUser();
  const lang = parseLang(url.searchParams.get('lang'));
  if (!user) {
    // Логин кабинета, затем — этот же launch (только внутренний путь, см. safeLaunchNext).
    // Относительный Location: за прокси хост request.url может быть внутренним.
    const next = new URLSearchParams({ next: `${url.pathname}${url.search}` });
    return new Response(null, {
      status: 302,
      headers: { ...NO_STORE, Location: `${lang === 'en' ? '/en/login' : '/login'}?${next.toString()}` },
    });
  }
  // Временный пароль от менеджера — сначала смена пароля в кабинете.
  if (user.mustChangePassword) {
    return new Response(null, {
      status: 302,
      headers: { ...NO_STORE, Location: `${lang === 'en' ? '/en' : ''}/change-password` },
    });
  }
  if (isRateLimited(`sso:${user.id}`, 30, 60_000)) return deny('rateLimited', 429);

  let leverage: number | null;
  try {
    leverage = await terminalLeverageFor(user.id);
  } catch (error) {
    console.error('[sso-launch] плечо клиента не прочитано — токен не выпускаем (Р-446)', error);
    return deny('leverage_unavailable', 503);
  }
  let fees: { markupBps: number; commissionBps: number } | null = null;
  try {
    fees = await terminalFeesFor(user.id);
  } catch (error) {
    console.error('[sso-launch] тариф клиента не прочитан — claim не кладём', error);
  }

  let handoff: HandoffToken;
  try {
    handoff = await issueHandoffToken(user.id, accountKind, leverage, fees);
  } catch (error) {
    if (error instanceof TokenWithoutExpiryError) {
      console.error(`[sso-launch] ${error.message} — токен не отдаём (Р-100, CAB-07)`);
      return deny('token_without_expiry', 503);
    }
    throw error;
  }

  const userLang = parseLang(user.locale);
  return new Response(null, {
    status: 302,
    headers: { ...NO_STORE, Location: launchLocation(returnUrl, handoff.token, accountKind, lang ?? userLang) },
  });
}
