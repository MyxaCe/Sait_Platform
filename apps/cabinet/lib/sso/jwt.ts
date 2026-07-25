import { randomUUID } from 'node:crypto';
import { exportJWK, importPKCS8, SignJWT, type JWK } from 'jose';

/**
 * SSO handoff-токены для терминала (ADR-023, решение B финализации):
 * короткоживущий one-shot JWT поверх наших opaque-сессий. Подпись RS256;
 * терминал валидирует по JWKS (подпись, exp, aud, одноразовость jti).
 * Выпуск живёт модулем кабинета, пока потребитель один; выделение
 * в Auth-сервис — при втором сайте (терминалу прозрачно: контракт — JWKS-URL).
 */

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
  // Публичный JWK выводим из приватного ключа (crypto), чтобы не хранить пару
  const { createPublicKey } = await import('node:crypto');
  const publicJwk = await exportJWK(createPublicKey(pem));
  publicJwk.kid = SSO_KEY_ID;
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';
  return { privateKey, publicJwk };
}

function getKeys(): Promise<SsoKeys> {
  globalStore.__ssoKeys ??= loadKeys().catch((error) => {
    // Не кешируем неудачу: env может появиться после рестарта конфига
    globalStore.__ssoKeys = null;
    throw error;
  });
  return globalStore.__ssoKeys;
}

export function isSsoConfigured(): boolean {
  return Boolean(process.env.SSO_PRIVATE_KEY_B64);
}

/** Тенант этого кабинета (slug сайта из реестра CMS). */
export function tenantSlug(): string {
  return process.env.SITE_SLUG ?? 'apex-ru';
}

export async function issueHandoffToken(userId: string): Promise<string> {
  const { privateKey } = await getKeys();
  return new SignJWT({ tenant: tenantSlug() })
    .setProtectedHeader({ alg: 'RS256', kid: SSO_KEY_ID, typ: 'JWT' })
    .setIssuer(SSO_ISSUER)
    .setAudience(SSO_AUDIENCE)
    .setSubject(userId)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${SSO_TOKEN_TTL_SECONDS}s`)
    .sign(privateKey);
}

export async function publicJwks(): Promise<{ keys: JWK[] }> {
  const { publicJwk } = await getKeys();
  return { keys: [publicJwk] };
}
