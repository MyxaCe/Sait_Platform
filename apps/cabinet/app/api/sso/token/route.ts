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

/**
 * Выпуск handoff-JWT для терминала. Только для живой сессии кабинета —
 * это и есть весь механизм «выход в кабинете = выход в терминале»:
 * погашенная сессия не может переотдать токен, терминал разлогинивается
 * не позднее своего TTL (≤15 мин).
 */
export const dynamic = 'force-dynamic';

/**
 * Счёт входа — `?account=demo|real` (без параметра — demo, как раньше).
 * Реальный счёт выдаётся только живой сессии незаблокированного клиента —
 * это гарантирует `getSessionUser` (блок → null → 401). Заморозку реального
 * счёта проверяет сам терминал: замороженный клиент должен иметь возможность
 * войти и закрыть позиции (дизайн §0 п.5).
 */
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
  /**
   * Тенант обязан быть НАЗВАН до выпуска подписи (PKG-05).
   *
   * Проверяется здесь, хотя гейт старта уже не пустил бы процесс без
   * слага: токен — это подпись, и у подписи не бывает «наверное».
   * Отказ назван машинным кодом рядом с `sso_not_configured`, а не
   * прилетает необработанным исключением: 500 без кода отправляет
   * разбираться в чужой лог, а терминалу нужен различимый исход.
   */
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
  if (isRateLimited(`sso:${user.id}`, 30, 60_000)) {
    return NextResponse.json({ error: 'rateLimited' }, { status: 429 });
  }

  /**
   * Срок жизни приходит ОТ ВЫПУСКА, посчитанный из самого токена (CAB-07).
   *
   * Раньше здесь стояла константа `SSO_TOKEN_TTL_SECONDS` — та же, что в
   * подписи, но отдельной строкой. Совпадали они по договорённости: правка
   * срока в подписи без правки этой строки разошлась бы молча, и кабинет
   * продолжал бы уверенно называть срок — неверный. Терминал по контракту
   * продлевает сессию ДО истечения и планирует продление по названному
   * числу, то есть «назвали больше настоящего» — это сессия, умершая
   * посреди работы, ровно тот отказ, который Р-100 отказывается принимать.
   *
   * Токен без названного срока не отдаётся вовсе — fail-closed и с нашей
   * стороны тоже. Названным кодом, а не необработанным исключением: 500
   * отправляет разбираться в чужой лог, а вызывающей странице нужен
   * различимый исход (на любой не-200 она гасит сессию терминала).
   */
  /**
   * Плечо счёта (claim `leverage`, Р-446). Терминал по нему синхронизирует
   * плечо для новых позиций на каждом входе и продлении. Не прочиталось —
   * токена нет (fail-closed): терминал иначе торговал бы по плечу, которое
   * сайт, возможно, уже сменил.
   */
  let leverage: number | null;
  try {
    leverage = await terminalLeverageFor(user.id);
  } catch (error) {
    console.error('[sso] плечо клиента не прочитано — токен не выпускаем (Р-446)', error);
    return NextResponse.json({ error: 'leverage_unavailable' }, { status: 503 });
  }

  /*
   * Тариф счёта (claims markup_bps/commission_bps). В отличие от плеча, сбой
   * чтения токен НЕ гасит: смену тарифа портфеля админка уже довезла до
   * терминала напрямую (fail-closed там), claim — догоняющая синхронизация
   * для счетов, открытых позже. Без claim терминал держит последний тариф.
   */
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
