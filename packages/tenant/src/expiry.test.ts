import { describe, expect, it } from 'vitest';
import { readAccess } from './access';
import { applyListExpiry, readListExpiry } from './expiry';

const ORIGIN = Date.parse('2026-10-06T12:00:00Z');

function headers(init: Record<string, string>) {
  return new Headers(init);
}

describe('источник назвал срок', () => {
  it('max-age отсчитывается от заголовка Date, а не от «сейчас»', () => {
    const expiry = readListExpiry(
      headers({ date: new Date(ORIGIN).toUTCString(), 'cache-control': 'public, max-age=60' }),
    );

    expect(expiry).toEqual({ state: 'named', expiresAt: ORIGIN + 60_000, source: 'response-headers' });
  });

  it('s-maxage перекрывает max-age: наш ISR-слой — общий кеш', () => {
    const expiry = readListExpiry(
      headers({
        date: new Date(ORIGIN).toUTCString(),
        'cache-control': 'max-age=600, s-maxage=30',
      }),
    );

    expect(expiry).toEqual({ state: 'named', expiresAt: ORIGIN + 30_000, source: 'response-headers' });
  });

  it('Expires в будущем — тоже названный срок', () => {
    const expiry = readListExpiry(
      headers({
        date: new Date(ORIGIN).toUTCString(),
        expires: new Date(ORIGIN + 120_000).toUTCString(),
      }),
    );

    expect(expiry).toEqual({ state: 'named', expiresAt: ORIGIN + 120_000, source: 'response-headers' });
  });

  it('РАСТЯЖКА: срок — абсолютный момент источника, а не «сейчас плюс N»', () => {
    const h = headers({
      date: new Date(ORIGIN).toUTCString(),
      'cache-control': 'max-age=60',
    });

    expect(readListExpiry(h)).toEqual(readListExpiry(h));
    expect(readListExpiry(h)).toEqual({ state: 'named', expiresAt: ORIGIN + 60_000, source: 'response-headers' });
  });
});

describe('источник о сроке промолчал', () => {
  it.each([
    ['заголовков нет вовсе', {}],
    ['no-store (так отвечает legacy)', { 'cache-control': 'no-store' }],
    ['private, no-cache (так отвечает v2)', { 'cache-control': 'private, no-cache' }],
    ['max-age=0', { 'cache-control': 'max-age=0' }],
    ['Expires в прошлом', { expires: new Date(ORIGIN - 1000).toUTCString() }],
    ['мусор в max-age', { 'cache-control': 'max-age=soon' }],
    ['max-age без значения', { 'cache-control': 'max-age' }],
  ])('%s → unnamed', (_name, init) => {
    expect(readListExpiry(headers({ date: new Date(ORIGIN).toUTCString(), ...init }))).toEqual({
      state: 'unnamed',
    });
  });

  it('max-age без заголовка Date — привязать не к чему, значит срок не назван', () => {
    expect(readListExpiry(headers({ 'cache-control': 'max-age=60' }))).toEqual({
      state: 'unnamed',
    });
  });

  it.each([
    ['бесконечность', 'max-age=1e999'],
    ['за пределами целого', 'max-age=99999999999999999999'],
  ])('%s в max-age не делает срок вечным', (_name, cacheControl) => {
    const expiry = readListExpiry(
      headers({ date: new Date(ORIGIN).toUTCString(), 'cache-control': cacheControl }),
    );

    expect(expiry).toEqual({ state: 'unnamed' });
  });
});

describe('истёкший список означает «закрыто»', () => {
  const allowed = readAccess(['BTCUSD']);
  const named = { state: 'named', expiresAt: ORIGIN + 60_000, source: 'response-headers' } as const;

  it('до срока — список действует', () => {
    expect(applyListExpiry(allowed, named, ORIGIN + 59_000)).toBe(allowed);
  });

  it('РАСТЯЖКА: после срока — unavailable:expired, а не «последний известный»', () => {
    const access = applyListExpiry(allowed, named, ORIGIN + 61_000);

    expect(access).toEqual({ state: 'unavailable', reason: 'expired' });
  });

  it('истечение пустого списка — тоже expired, а не empty', () => {
    expect(applyListExpiry(readAccess([]), named, ORIGIN + 61_000)).toEqual({
      state: 'unavailable',
      reason: 'expired',
    });
  });

  it('причина `expired` отличима от `network`: сеть цела, CMS жива', () => {
    const access = applyListExpiry(allowed, named, ORIGIN + 61_000);

    expect(access).not.toEqual({ state: 'unavailable', reason: 'network' });
  });

  it('у недоступного списка возраста нет — причину не подменяем', () => {
    const down = readAccess(undefined);

    expect(applyListExpiry(down, named, ORIGIN + 61_000)).toBe(down);
  });

  it('срок не назван → действует наше редакционное окно (открытый пункт Р-030)', () => {
    expect(applyListExpiry(allowed, { state: 'unnamed' }, ORIGIN + 10 ** 9)).toBe(allowed);
  });
});
