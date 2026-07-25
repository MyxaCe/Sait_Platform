import { generateKeyPairSync } from 'node:crypto';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Контракт handoff-JWT (SSO-пакет для терминала): подпись RS256 по JWKS,
 * claims iss/aud/sub/tenant/jti/exp≤60с — ровно то, что валидирует терминал.
 */

beforeAll(() => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  process.env.SSO_PRIVATE_KEY_B64 = Buffer.from(pem).toString('base64');
  process.env.SITE_SLUG = 'apex-ru';
});

describe('SSO handoff-JWT', () => {
  it('токен валидируется по нашему же JWKS со всеми claims контракта', async () => {
    const { issueHandoffToken, publicJwks, SSO_AUDIENCE, SSO_ISSUER } = await import('./jwt');

    const token = await issueHandoffToken('user-123');
    const jwks = createLocalJWKSet(await publicJwks());

    const { payload, protectedHeader } = await jwtVerify(token, jwks, {
      issuer: SSO_ISSUER,
      audience: SSO_AUDIENCE,
    });

    expect(protectedHeader.alg).toBe('RS256');
    expect(protectedHeader.kid).toBe('platform-sso-1');
    expect(payload.sub).toBe('user-123');
    expect(payload.tenant).toBe('apex-ru');
    expect(typeof payload.jti).toBe('string');
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBeLessThanOrEqual(60);
  });

  it('подделка не проходит: чужой ключ отклоняется', async () => {
    const { publicJwks } = await import('./jwt');
    const { SignJWT } = await import('jose');
    const { privateKey: foreign } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const { importPKCS8 } = await import('jose');
    const foreignKey = await importPKCS8(foreign.export({ type: 'pkcs8', format: 'pem' }) as string, 'RS256');

    const forged = await new SignJWT({ tenant: 'apex-ru' })
      .setProtectedHeader({ alg: 'RS256', kid: 'platform-sso-1' })
      .setIssuer('platform-auth')
      .setAudience('terminal')
      .setSubject('hacker')
      .setExpirationTime('60s')
      .sign(foreignKey);

    const jwks = createLocalJWKSet(await publicJwks());
    await expect(jwtVerify(forged, jwks)).rejects.toThrow();
  });
});
