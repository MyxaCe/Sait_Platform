import { SignJWT } from 'jose/jwt/sign';
import { jwtVerify } from 'jose/jwt/verify';

export const ADMIN_ISSUER = 'platform-admin';
export const ADMIN_AUDIENCE = 'admin-center';
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

export type OperatorRole = 'admin' | 'operator' | 'finance_operator' | 'support_operator';

export interface OperatorSession {
  operatorId: string;
  login: string;
  displayName: string;
  role: OperatorRole;
}

function getSecret(): Uint8Array | null {
  const raw = process.env.ADMIN_SESSION_SECRET;
  if (!raw) return null;
  return new TextEncoder().encode(raw);
}

function asRole(value: unknown): OperatorRole | null {
  return value === 'admin' || value === 'operator' || value === 'finance_operator' || value === 'support_operator'
    ? value
    : null;
}

export async function verifyOperatorSession(
  token: string | undefined,
): Promise<OperatorSession | null> {
  if (!token) return null;

  const secret = getSecret();
  if (!secret) {
    console.error(
      '[admin-gate] ADMIN_SESSION_SECRET не задан — операторская сессия невалидна, ' +
        'доступ закрыт по умолчанию (Р-394)',
    );
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: ADMIN_ISSUER,
      audience: ADMIN_AUDIENCE,
    });

    const role = asRole(payload.role);
    const login = typeof payload.login === 'string' ? payload.login : null;
    const displayName = typeof payload.name === 'string' ? payload.name : null;
    const operatorId = typeof payload.sub === 'string' ? payload.sub : null;

    if (!operatorId || !login || !displayName || !role) return null;

    return { operatorId, login, displayName, role };
  } catch {
    return null;
  }
}

export async function issueOperatorSessionToken(
  session: OperatorSession,
  ttlSeconds: number = SESSION_TTL_SECONDS,
): Promise<string> {
  const secret = getSecret();
  if (!secret) {
    throw new Error('ADMIN_SESSION_SECRET не задан — операторскую сессию выпустить нельзя');
  }
  return new SignJWT({ login: session.login, name: session.displayName, role: session.role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ADMIN_ISSUER)
    .setAudience(ADMIN_AUDIENCE)
    .setSubject(session.operatorId)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secret);
}
