import { randomUUID } from 'node:crypto';
import { decodeJwt, exportJWK, importPKCS8, SignJWT, type JWK } from 'jose';
import { requireTenantSlug } from '@broker/tenant';

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
  // ОТКАЗ, а не умолчание (PKG-05). Здесь цена выше всего: токен —
  // это подпись, и назвать в ней чужого тенанта значит подписать
  // документ от чужого имени. Следа ни на экране, ни в логе такая
  // подмена не оставляет, поэтому единственный безопасный исход —
  // не выдать токен вовсе.
  return requireTenantSlug(process.env.SITE_SLUG, 'выдача SSO-токена');
}

/** Токен вместе с его СОБСТВЕННЫМ сроком жизни — одной величиной, не двумя. */
export interface HandoffToken {
  token: string;
  /** Секунды, посчитанные из `exp − iat` выпущенного токена. */
  expiresIn: number;
}

/** Выпущенный токен не назвал срок — выпускать его нельзя (Р-100). */
export class TokenWithoutExpiryError extends Error {
  constructor(missing: string) {
    super(`выпущенный handoff-токен не называет срок жизни: нет ${missing}`);
    this.name = 'TokenWithoutExpiryError';
  }
}

/**
 * Срок жизни токена, прочитанный ИЗ НЕГО САМОГО.
 *
 * Отдельной функцией, потому что это единственное место, где «сколько живёт
 * токен» становится числом для внешнего мира. Пока число бралось из
 * константы рядом с подписью, оно совпадало с настоящим сроком только по
 * договорённости: правка в одной строке и неправка в другой разошлись бы
 * молча, а кабинет продолжал бы уверенно называть срок — неверный.
 *
 * Отсутствие `exp` или `iat` — отказ, а не умолчание. Ноль здесь означал бы
 * «истекает немедленно», и терминал, по контракту продлевающий сессию до
 * истечения, начал бы просить новый токен без остановки: отказ, замаскированный
 * под нагрузку, видимый только по счётчикам соседа (ровно это терминал у себя
 * и чинил в TRM-24).
 */
export function tokenLifetimeSeconds(token: string): number {
  const { exp, iat } = decodeJwt(token);
  if (typeof exp !== 'number') throw new TokenWithoutExpiryError('exp');
  if (typeof iat !== 'number') throw new TokenWithoutExpiryError('iat');
  return exp - iat;
}

export async function issueHandoffToken(userId: string): Promise<HandoffToken> {
  const { privateKey } = await getKeys();
  const token = await new SignJWT({ tenant: tenantSlug() })
    .setProtectedHeader({ alg: 'RS256', kid: SSO_KEY_ID, typ: 'JWT' })
    .setIssuer(SSO_ISSUER)
    .setAudience(SSO_AUDIENCE)
    .setSubject(userId)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${SSO_TOKEN_TTL_SECONDS}s`)
    .sign(privateKey);

  // Срок читается из подписанного токена, а не повторяется константой:
  // разойтись им теперь негде.
  return { token, expiresIn: tokenLifetimeSeconds(token) };
}

export async function publicJwks(): Promise<{ keys: JWK[] }> {
  const { publicJwk } = await getKeys();
  return { keys: [publicJwk] };
}
