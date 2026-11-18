import { randomUUID } from 'node:crypto';
import { decodeJwt, exportJWK, importPKCS8, SignJWT, type JWK } from 'jose';
import { requireTenantSlug } from '@broker/tenant';

export const SSO_ISSUER = 'platform-auth';
export const SSO_AUDIENCE = 'terminal';
export const SSO_TOKEN_TTL_SECONDS = 60;
export const SSO_KEY_ID = 'platform-sso-1';

interface SsoKeys {
  privateKey: CryptoKey;
  publicJwk: JWK;
}

const globalStore = globalThis as unknown as { __ssoKeys?: Promise<SsoKeys> | null };

async function loadKeys(): Promise<SsoKeys> {
  const b64 = process.env.SSO_PRIVATE_KEY_B64;
  if (!b64) {
    throw new Error('SSO_PRIVATE_KEY_B64 is not set');
  }
  const pem = Buffer.from(b64, 'base64').toString('utf8');
  const privateKey = await importPKCS8(pem, 'RS256');
  const { createPublicKey } = await import('node:crypto');
  const publicJwk = await exportJWK(createPublicKey(pem));
  publicJwk.kid = SSO_KEY_ID;
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';
  return { privateKey, publicJwk };
}

function getKeys(): Promise<SsoKeys> {
  globalStore.__ssoKeys ??= loadKeys().catch((error) => {
    globalStore.__ssoKeys = null;
    throw error;
  });
  return globalStore.__ssoKeys;
}

export function isSsoConfigured(): boolean {
  return Boolean(process.env.SSO_PRIVATE_KEY_B64);
}

export function tenantSlug(): string {
  return requireTenantSlug(process.env.SITE_SLUG, 'выдача SSO-токена');
}

export interface HandoffToken {
  token: string;
  expiresIn: number;
}

export class TokenWithoutExpiryError extends Error {
  constructor(missing: string) {
    super(`выпущенный handoff-токен не называет срок жизни: нет ${missing}`);
    this.name = 'TokenWithoutExpiryError';
  }
}

export function tokenLifetimeSeconds(token: string): number {
  const { exp, iat } = decodeJwt(token);
  if (typeof exp !== 'number') throw new TokenWithoutExpiryError('exp');
  if (typeof iat !== 'number') throw new TokenWithoutExpiryError('iat');
  return exp - iat;
}

export type AccountKind = 'demo' | 'real';

export function parseAccountKind(value: unknown): AccountKind | null {
  if (value === undefined || value === null || value === '') return 'demo';
  return value === 'demo' || value === 'real' ? value : null;
}

export async function issueHandoffToken(
  userId: string,
  accountKind: AccountKind = 'demo',
  leverage: number | null = null,
  fees: { markupBps: number; commissionBps: number } | null = null,
): Promise<HandoffToken> {
  const { privateKey } = await getKeys();
  const claims: Record<string, unknown> = { tenant: tenantSlug(), account_kind: accountKind };
  if (leverage !== null) {
    if (!Number.isInteger(leverage) || leverage < 1 || leverage > 1000) {
      throw new Error(`плечо для токена вне 1..1000: ${String(leverage)}`);
    }
    claims.leverage = leverage;
  }
  if (fees !== null) {
    for (const v of [fees.markupBps, fees.commissionBps]) {
      if (!Number.isInteger(v) || v < 0 || v > 500) {
        throw new Error(`тариф для токена вне 0..500 б.п.: ${String(v)}`);
      }
    }
    claims.markup_bps = fees.markupBps;
    claims.commission_bps = fees.commissionBps;
  }
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: SSO_KEY_ID, typ: 'JWT' })
    .setIssuer(SSO_ISSUER)
    .setAudience(SSO_AUDIENCE)
    .setSubject(userId)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${SSO_TOKEN_TTL_SECONDS}s`)
    .sign(privateKey);

  return { token, expiresIn: tokenLifetimeSeconds(token) };
}

export async function publicJwks(): Promise<{ keys: JWK[] }> {
  const { publicJwk } = await getKeys();
  return { keys: [publicJwk] };
}
