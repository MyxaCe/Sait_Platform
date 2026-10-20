import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { isRateLimited } from '@/lib/rate-limit';
import {
  issueHandoffToken,
  isSsoConfigured,
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

export async function POST() {
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
  let handoff: HandoffToken;
  try {
    handoff = await issueHandoffToken(user.id);
  } catch (error) {
    if (error instanceof TokenWithoutExpiryError) {
      console.error(`[sso] ${error.message} — токен не отдаём (Р-100, CAB-07)`);
      return NextResponse.json({ error: 'token_without_expiry' }, { status: 503 });
    }
    throw error;
  }

  return NextResponse.json(
    { token: handoff.token, tenant, expiresIn: handoff.expiresIn },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
