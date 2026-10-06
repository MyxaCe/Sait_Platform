import { describe, expect, it } from 'vitest';
import { readAccess } from './access';
import { applyListExpiry, readListExpiry } from './expiry';

/**
 * Срок годности списка — решение штаба Р-030.
 *
 * Два разных утверждения проверяются по отдельности:
 *   1. что именно источник сказал о сроке (`readListExpiry`);
 *   2. что истёкший список закрывает границу (`applyListExpiry`).
 *
 * Склеивать их нельзя: первое — разбор чужого ответа, второе — наше
 * решение. Мутация в каждом красит свой набор.
 */

const ORIGIN = Date.parse('2026-10-06T12:00:00Z');

function headers(init: Record<string, string>) {
  return new Headers(init);
}

describe('источник назвал срок', () => {
  it('max-age отсчитывается от заголовка Date, а не от «сейчас»', () => {
    const expiry = readListExpiry(
      headers({ date: new Date(ORIGIN).toUTCString(), 'cache-control': 'public, max-age=60' }),
    );

    expect(expiry).toEqual({ state: 'named', expiresAt: ORIGIN + 60_000 });
  });

  it('s-maxage перекрывает max-age: наш ISR-слой — общий кеш', () => {
    const expiry = readListExpiry(
      headers({
        date: new Date(ORIGIN).toUTCString(),
        'cache-control': 'max-age=600, s-maxage=30',
      }),
    );

    expect(expiry).toEqual({ state: 'named', expiresAt: ORIGIN + 30_000 });
  });

  it('Expires в будущем — тоже названный срок', () => {
    const expiry = readListExpiry(
      headers({
        date: new Date(ORIGIN).toUTCString(),
        expires: new Date(ORIGIN + 120_000).toUTCString(),
      }),
    );

    expect(expiry).toEqual({ state: 'named', expiresAt: ORIGIN + 120_000 });
  });

  it('РАСТЯЖКА: срок — абсолютный момент источника, а не «сейчас плюс N»', () => {
    const h = headers({
      date: new Date(ORIGIN).toUTCString(),
      'cache-control': 'max-age=60',
    });

    // Тот же ответ, разобранный дважды в разные моменты, обязан дать ОДИН
    // и тот же срок. Мутация «отсчитывать от Date.now()» красит этот тест:
    // окно, отсчитанное от момента разбора, обнуляется при каждом чтении
    // из кеша данных, и список не истекает никогда.
    expect(readListExpiry(h)).toEqual(readListExpiry(h));
    expect(readListExpiry(h)).toEqual({ state: 'named', expiresAt: ORIGIN + 60_000 });
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
    // `no-store` и `no-cache` — про переиспользование ОТВЕТА посредником,
    // а не про срок действия разрешений. Прочитать одно как другое значит
    // закрыть границу по заголовку, который говорит о другом.
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
  const named = { state: 'named', expiresAt: ORIGIN + 60_000 } as const;

  it('до срока — список действует', () => {
    expect(applyListExpiry(allowed, named, ORIGIN + 59_000)).toBe(allowed);
  });

  it('РАСТЯЖКА: после срока — unavailable:expired, а не «последний известный»', () => {
    const access = applyListExpiry(allowed, named, ORIGIN + 61_000);

    // Мутация «продолжаем по последнему известному» красит этот тест.
    // Список меняется ровно потому, что меняются разрешения: устаревание
    // бьёт по единственному свойству, ради которого он существует.
    expect(access).toEqual({ state: 'unavailable', reason: 'expired' });
  });

  it('истечение пустого списка — тоже expired, а не empty', () => {
    // «Ничего не разрешено» и «разрешениям этого возраста верить нельзя» —
    // два разных состояния, и чинятся они в разных местах.
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
    // Сегодня исполняется именно эта ветка: ни legacy, ни v2 срока не
    // называют. Пункт записан в TD-015 и в отчёте штабу — чтобы «срок
    // по-прежнему наш» нельзя было принять за сделанное.
    expect(applyListExpiry(allowed, { state: 'unnamed' }, ORIGIN + 10 ** 9)).toBe(allowed);
  });
});
