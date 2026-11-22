import { generateKeyPairSync } from 'node:crypto';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 20_000 });


beforeAll(() => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  process.env.SSO_PRIVATE_KEY_B64 = Buffer.from(pem).toString('base64');
  process.env.SITE_SLUG = 'apex-ru';
});

describe('SSO handoff-JWT', () => {
  it('токен валидируется по нашему же JWKS со всеми claims контракта', async () => {
    const { issueHandoffToken, publicJwks, SSO_AUDIENCE, SSO_ISSUER } = await import('./jwt');

    const { token } = await issueHandoffToken('user-123');
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

    expect(typeof payload.exp).toBe('number');
    expect(typeof payload.iat).toBe('number');
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(60);
  });

  it('jti свой на каждый выпуск — иначе одноразовость терминала бессильна', async () => {
    const { issueHandoffToken } = await import('./jwt');
    const { decodeJwt } = await import('jose');

    const ids = await Promise.all(
      Array.from({ length: 25 }, () =>
        issueHandoffToken('user-123').then(({ token }) => decodeJwt(token).jti),
      ),
    );

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => typeof id === 'string' && id.length >= 16)).toBe(true);
  });

  it('истекает через 60 секунд: на 61-й токен отвергнут по exp', async () => {
    const { issueHandoffToken, publicJwks, SSO_AUDIENCE, SSO_ISSUER } = await import('./jwt');
    const { token } = await issueHandoffToken('user-123');
    const jwks = createLocalJWKSet(await publicJwks());
    const verify = (atMs: number) =>
      jwtVerify(token, jwks, {
        issuer: SSO_ISSUER,
        audience: SSO_AUDIENCE,
        currentDate: new Date(Date.now() + atMs),
        clockTolerance: 0,
      });

    await expect(verify(55_000)).resolves.toBeDefined();
    await expect(verify(61_000)).rejects.toThrow(/exp/i);
  });

  it('tenant берётся от сайта, а не от запрашивающего', async () => {
    const { decodeJwt } = await import('jose');

    process.env.SITE_SLUG = 'apex-de';
    vi.resetModules();
    const german = await import('./jwt');
    expect(decodeJwt((await german.issueHandoffToken('user-123')).token).tenant).toBe('apex-de');

    process.env.SITE_SLUG = 'apex-ru';
    vi.resetModules();
    const russian = await import('./jwt');
    const { token } = await russian.issueHandoffToken('user-123');
    expect(decodeJwt(token).tenant).toBe('apex-ru');

    expect(russian.issueHandoffToken.length).toBe(1);
  });

  it('account_kind: по умолчанию demo, real — по запросу (демо/реал разделены, 09.11)', async () => {
    const { decodeJwt } = await import('jose');
    const { issueHandoffToken, parseAccountKind } = await import('./jwt');
    expect(decodeJwt((await issueHandoffToken('user-123')).token).account_kind).toBe('demo');
    expect(decodeJwt((await issueHandoffToken('user-123', 'real')).token).account_kind).toBe('real');
    expect(parseAccountKind(null)).toBe('demo');
    expect(parseAccountKind('real')).toBe('real');
    expect(parseAccountKind('vip')).toBeNull();
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

describe('CAB-07 · срок жизни назван и соответствует самому токену', () => {
  it('выпуск отдаёт срок вместе с токеном', async () => {
    const { issueHandoffToken } = await import('./jwt');

    const handoff = await issueHandoffToken('user-123');

    expect(typeof handoff.expiresIn).toBe('number');
    expect(handoff.expiresIn).toBeGreaterThan(0);
  });

  it('названный срок равен настоящему `exp − iat` выпущенного токена', async () => {
    const { issueHandoffToken } = await import('./jwt');
    const { decodeJwt } = await import('jose');

    const { token, expiresIn } = await issueHandoffToken('user-123');
    const { exp, iat } = decodeJwt(token);

    expect(exp! - iat!).toBe(expiresIn);
  });

  it('токен без `exp` — отказ, а не ноль секунд', async () => {
    const { tokenLifetimeSeconds, TokenWithoutExpiryError } = await import('./jwt');
    const { SignJWT } = await import('jose');
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const { importPKCS8 } = await import('jose');
    const key = await importPKCS8(privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, 'RS256');

    const noExp = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuedAt()
      .sign(key);

    expect(() => tokenLifetimeSeconds(noExp)).toThrow(TokenWithoutExpiryError);
  });

  it('токен без `iat` — тоже отказ: разность не из чего считать', async () => {
    const { tokenLifetimeSeconds, TokenWithoutExpiryError } = await import('./jwt');
    const { SignJWT } = await import('jose');
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const { importPKCS8 } = await import('jose');
    const key = await importPKCS8(privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, 'RS256');

    const noIat = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256' })
      .setExpirationTime('60s')
      .sign(key);

    expect(() => tokenLifetimeSeconds(noIat)).toThrow(TokenWithoutExpiryError);
  });
});

describe('SSO handoff-JWT · claim leverage (Р-446)', () => {
  it('плечо названо — claim в токене; не названо — claim-а нет', async () => {
    const { issueHandoffToken, publicJwks } = await import('./jwt');
    const jwks = createLocalJWKSet(await publicJwks());

    const withLev = await issueHandoffToken('user-1', 'real', 10);
    const a = await jwtVerify(withLev.token, jwks);
    expect(a.payload.leverage).toBe(10);
    expect(a.payload.account_kind).toBe('real');

    const without = await issueHandoffToken('user-1', 'demo', null);
    const b = await jwtVerify(without.token, jwks);
    expect('leverage' in b.payload).toBe(false);
  });

  it('плечо вне 1..1000 — подписи нет (терминал такой claim отверг бы)', async () => {
    const { issueHandoffToken } = await import('./jwt');
    for (const bad of [0, 1001, 2.5]) {
      await expect(issueHandoffToken('user-1', 'demo', bad)).rejects.toThrow(/1\.\.1000/);
    }
  });
});
