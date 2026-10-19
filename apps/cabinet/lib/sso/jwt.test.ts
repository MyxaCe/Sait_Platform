import { generateKeyPairSync } from 'node:crypto';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Контракт handoff-JWT (SSO-пакет для терминала): подпись RS256 по JWKS,
 * claims iss/aud/sub/tenant/jti/exp≤60с — ровно то, что валидирует терминал.
 *
 * **CAB-02.** Тестов тут было два, оба про форму токена, а задача
 * числилась закрытой — штаб пометил её готовой, сверяя статусы пачкой.
 * Барьеры выпуска (живая сессия, rate limit, ненастроенный ключ) стоят в
 * ручке и проверяются в `app/api/sso/token/route.test.ts`; здесь —
 * свойства самого токена.
 *
 * **Чего здесь нет и быть не может.** Пункт «второй обмен тем же токеном
 * обязан отказать» нашей стороной не закрывается: гашение `jti` живёт в
 * ТЕРМИНАЛЕ, у кабинета реестра предъявленных токенов нет и не должно
 * быть. Наша половина контракта — уникальность `jti` на каждый выпуск,
 * и только она здесь проверяется; сам барьер одноразовости закрывается
 * живым прогоном CAB-03/TRM-04. Дыра названа вслух намеренно: тест,
 * который «проверял» бы одноразовость на нашей стороне, проверял бы
 * выдуманный механизм.
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

  it('jti свой на каждый выпуск — иначе одноразовость терминала бессильна', async () => {
    // Наша половина контракта одноразовости. Повторяющийся `jti` означал
    // бы, что второй законный вход отвергается как повтор первого: защита
    // от переигрывания превратилась бы в способ сорвать вход.
    const { issueHandoffToken } = await import('./jwt');
    const { decodeJwt } = await import('jose');

    const ids = await Promise.all(
      Array.from({ length: 25 }, () => issueHandoffToken('user-123').then((t) => decodeJwt(t).jti)),
    );

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => typeof id === 'string' && id.length >= 16)).toBe(true);
  });

  it('истекает через 60 секунд: на 61-й токен отвергнут по exp', async () => {
    // Проверяется наблюдаемым различием, а не чтением поля: `exp` можно
    // записать и не применить. Часы двигаются параметром `currentDate`,
    // а не ожиданием — иначе тест либо висит минуту, либо не гоняется.
    const { issueHandoffToken, publicJwks, SSO_AUDIENCE, SSO_ISSUER } = await import('./jwt');
    const token = await issueHandoffToken('user-123');
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
    // Токен говорит, ОТ ИМЕНИ КАКОГО сайта он выпущен. Если бы значение
    // приходило снаружи, им бы и подменяли юрисдикцию — граница доступа
    // проверяется терминалом именно по нему.
    const { decodeJwt } = await import('jose');

    process.env.SITE_SLUG = 'apex-de';
    vi.resetModules();
    const german = await import('./jwt');
    expect(decodeJwt(await german.issueHandoffToken('user-123')).tenant).toBe('apex-de');

    process.env.SITE_SLUG = 'apex-ru';
    vi.resetModules();
    const russian = await import('./jwt');
    const token = await russian.issueHandoffToken('user-123');
    expect(decodeJwt(token).tenant).toBe('apex-ru');

    // Растяжка: у выпуска ОДИН аргумент — идентификатор пользователя.
    // Появится второй — проверка напомнит, что `tenant` снаружи не берут.
    expect(russian.issueHandoffToken.length).toBe(1);
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
