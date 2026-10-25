import { generateKeyPairSync } from 'node:crypto';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';

/*
 * Предел времени поднят ЭТОМУ файлу (WEB-33), и только ему.
 *
 * Здесь работу делает криптография, а не загрузчик модулей: выпуск и
 * проверка подписи RSA. Вынести её из измеряемого промежутка нельзя —
 * она и есть предмет проверки. В покое: выпуск токена 505 мс,
 * проверка по JWKS 373 мс.
 *
 * Под полным прогоном (10 задач turbo, у каждой свой пул потоков, на
 * 8 ядрах) те же проверки показывали 6854 мс и 5093 мс — раздувание в
 * 13,6 раза. Предел в 5 с срабатывал не на медленности кода, а на
 * очереди за процессором.
 *
 * Общий предел не трогаем: он остаётся сторожем настоящей
 * медленности. Поднимать его всем значило бы спрятать стоимость —
 * завтра медленным станет что-то настоящее, и мы этого не увидим.
 */
vi.setConfig({ testTimeout: 20_000 });


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

    // Было `(payload.exp ?? 0) - (payload.iat ?? 0)`: та же подстановка нуля,
    // которую мы ищем по всему проекту, только в ассерте. Без `exp` разность
    // становилась большим отрицательным числом, «≤ 60» выполнялось, и
    // проверка срока оставалась ЗЕЛЁНОЙ на токене без срока. Сначала требуем
    // наличие claims, потом сравниваем.
    expect(typeof payload.exp).toBe('number');
    expect(typeof payload.iat).toBe('number');
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(60);
  });

  it('jti свой на каждый выпуск — иначе одноразовость терминала бессильна', async () => {
    // Наша половина контракта одноразовости. Повторяющийся `jti` означал
    // бы, что второй законный вход отвергается как повтор первого: защита
    // от переигрывания превратилась бы в способ сорвать вход.
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
    // Проверяется наблюдаемым различием, а не чтением поля: `exp` можно
    // записать и не применить. Часы двигаются параметром `currentDate`,
    // а не ожиданием — иначе тест либо висит минуту, либо не гоняется.
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
    // Токен говорит, ОТ ИМЕНИ КАКОГО сайта он выпущен. Если бы значение
    // приходило снаружи, им бы и подменяли юрисдикцию — граница доступа
    // проверяется терминалом именно по нему.
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

/**
 * CAB-07 · кабинет обязан называть срок жизни токена ВСЕГДА, и названное
 * число обязано быть правдой.
 *
 * Терминал теперь fail-closed (Р-100): сессию без названного срока он не
 * принимает вовсе. Цена ужесточения названа вслух — если кабинет в каком-то
 * режиме срок не отдаёт, человек не войдёт. Поэтому проверяется не только
 * «поле присутствует», но и «поле не врёт»: по нему терминал планирует тихое
 * продление ДО истечения, и срок больше настоящего означает сессию, умершую
 * посреди работы.
 */
describe('CAB-07 · срок жизни назван и соответствует самому токену', () => {
  it('выпуск отдаёт срок вместе с токеном', async () => {
    const { issueHandoffToken } = await import('./jwt');

    const handoff = await issueHandoffToken('user-123');

    expect(typeof handoff.expiresIn).toBe('number');
    expect(handoff.expiresIn).toBeGreaterThan(0);
  });

  it('названный срок равен настоящему `exp − iat` выпущенного токена', async () => {
    // Главное свойство. Раньше ручка повторяла константу отдельной строкой,
    // и совпадение держалось на договорённости: правка срока в подписи без
    // правки той строки разошлась бы молча.
    const { issueHandoffToken } = await import('./jwt');
    const { decodeJwt } = await import('jose');

    const { token, expiresIn } = await issueHandoffToken('user-123');
    const { exp, iat } = decodeJwt(token);

    expect(exp! - iat!).toBe(expiresIn);
  });

  it('токен без `exp` — отказ, а не ноль секунд', async () => {
    // Ноль здесь читался бы как «истекает немедленно»: терминал начал бы
    // просить новый токен без остановки — отказ, замаскированный под
    // нагрузку, видимый только по счётчикам соседа (его же TRM-24).
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
