// Те же субпути jose, что в session.ts (баррель тянет edge-недружелюбную
// JWE-ветку). Эти тикеты используются только в server actions (node), но стиль
// импорта держим единым.
import { SignJWT } from 'jose/jwt/sign';
import { jwtVerify } from 'jose/jwt/verify';
import { ADMIN_ISSUER } from './session';

/**
 * Краткоживущие ПОДПИСАННЫЕ тикеты двух шагов TOTP (ADM-13, Р-454):
 *
 *  - CHALLENGE — «пароль проверен для operatorId, ждём второй фактор». Выдаётся
 *    после верного пароля, хранится в httpOnly-куке, живёт 5 минут. Это НЕ
 *    сессия: другой issuer/audience, не проходит `verifyOperatorSession`, сам
 *    по себе внутрь не пускает. Пароль наверх между шагами не передаётся —
 *    identity несёт этот тикет.
 *  - ENROLL — непроверенный секрет на время регистрации. Живёт 10 минут в
 *    httpOnly-куке. Секрет лежит ВНУТРИ подписанного тикета, а не в базе: пока
 *    оператор не докажет владение верным кодом, в `operators.totp_secret`
 *    ничего не пишется (инвариант «секрет в базе = 2FA подтверждена»).
 *
 * Секрет подписи — тот же `ADMIN_SESSION_SECRET` (нет секрета → fail-closed,
 * тикет невалиден). Назначение разводится audience: тикет одного шага не сойдёт
 * за тикет другого и тем более за сессию.
 */

const CHALLENGE_AUDIENCE = 'admin-totp-challenge';
const ENROLL_AUDIENCE = 'admin-totp-enroll';

/** Второй фактор — короткое окно: 5 минут на ввод кода после пароля. */
export const TOTP_CHALLENGE_TTL_SECONDS = 5 * 60;
/** Регистрация — 10 минут на сканирование и ввод первого кода. */
export const TOTP_ENROLL_TTL_SECONDS = 10 * 60;

function getSecret(): Uint8Array | null {
  const raw = process.env.ADMIN_SESSION_SECRET;
  if (!raw) return null;
  return new TextEncoder().encode(raw);
}

/** Тикет «пароль проверен, жду TOTP». */
export async function issueTotpChallenge(operatorId: string): Promise<string> {
  const secret = getSecret();
  if (!secret) {
    throw new Error('ADMIN_SESSION_SECRET не задан — тикет второго фактора выпустить нельзя');
  }
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ADMIN_ISSUER)
    .setAudience(CHALLENGE_AUDIENCE)
    .setSubject(operatorId)
    .setIssuedAt()
    .setExpirationTime(`${TOTP_CHALLENGE_TTL_SECONDS}s`)
    .sign(secret);
}

/** operatorId из валидного CHALLENGE-тикета или `null` (молчание = «нельзя»). */
export async function verifyTotpChallenge(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const secret = getSecret();
  if (!secret) return null;
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: ADMIN_ISSUER,
      audience: CHALLENGE_AUDIENCE,
    });
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

/** Тикет регистрации: несёт непроверенный секрет, привязан к оператору. */
export async function issueEnrollTicket(operatorId: string, secretBase32: string): Promise<string> {
  const secret = getSecret();
  if (!secret) {
    throw new Error('ADMIN_SESSION_SECRET не задан — тикет регистрации выпустить нельзя');
  }
  return new SignJWT({ totp: secretBase32 })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ADMIN_ISSUER)
    .setAudience(ENROLL_AUDIENCE)
    .setSubject(operatorId)
    .setIssuedAt()
    .setExpirationTime(`${TOTP_ENROLL_TTL_SECONDS}s`)
    .sign(secret);
}

export interface EnrollTicket {
  operatorId: string;
  secret: string;
}

/** {operatorId, secret} из валидного ENROLL-тикета или `null`. */
export async function verifyEnrollTicket(token: string | undefined): Promise<EnrollTicket | null> {
  if (!token) return null;
  const secret = getSecret();
  if (!secret) return null;
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: ADMIN_ISSUER,
      audience: ENROLL_AUDIENCE,
    });
    const operatorId = typeof payload.sub === 'string' ? payload.sub : null;
    const totp = typeof payload.totp === 'string' ? payload.totp : null;
    if (!operatorId || !totp) return null;
    return { operatorId, secret: totp };
  } catch {
    return null;
  }
}
