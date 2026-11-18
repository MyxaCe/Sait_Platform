import { SignJWT } from 'jose/jwt/sign';
import { jwtVerify } from 'jose/jwt/verify';
import { ADMIN_ISSUER } from './session';

const CHALLENGE_AUDIENCE = 'admin-totp-challenge';
const ENROLL_AUDIENCE = 'admin-totp-enroll';

export const TOTP_CHALLENGE_TTL_SECONDS = 5 * 60;
export const TOTP_ENROLL_TTL_SECONDS = 10 * 60;

function getSecret(): Uint8Array | null {
  const raw = process.env.ADMIN_SESSION_SECRET;
  if (!raw) return null;
  return new TextEncoder().encode(raw);
}

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
