import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getTenantConfig,
  getTenantStartBalance,
  isSymbolAllowed,
  type TenantAccess,
} from './tenant';

/**
 * Граница доступа кабинета к инструментам — решения штаба Р-025, Р-029 и
 * Р-040.
 *
 * **Копий больше нет.** Решение переехало в `@broker/tenant` (PKG-04), и
 * этот файл из «парной копии» стал проверкой того, что кабинет границу
 * ВЫЗЫВАЕТ. Таблица «вход → состояние» осталась дословно той же, что у
 * витрины, — теперь она доказывает не соответствие двух реализаций, а
 * то, что обе стороны спрашивают одну.
 *
 * Отдельно проверяется второе поле конфига — стартовый демо-баланс. Его
 * политика ПЕРЕВЁРНУТА решением Р-040: умолчание отменено, `null`
 * означает отказ. Прежнее обоснование («демо-деньги — параметр удобства,
 * умолчание ничего не разрешает») записано в `packages/tenant/src/balance.ts`
 * как отменённое, а не вычеркнуто: отличить отменённое от забытого можно
 * только по записанному намерению.
 */

const ALL_STATES: TenantAccess[] = [
  { state: 'allowed', symbols: new Set(['BTCUSD']) },
  { state: 'empty' },
  { state: 'unavailable', reason: 'not-configured' },
  { state: 'unavailable', reason: 'http-error' },
  { state: 'unavailable', reason: 'network' },
  { state: 'unavailable', reason: 'malformed' },
  { state: 'unavailable', reason: 'expired' },
];

/** Сумма, которую подставляла legacy. Ни одно состояние не вправе её дать. */
const LEGACY_DEFAULT = 1_000_000;

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubEnv('CMS_API_URL', 'http://cms.test');
  vi.stubEnv('CMS_API_KEY', '');
  vi.stubEnv('SITE_SLUG', 'apex-ru');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetch(impl: () => Promise<Response>) {
  const mock = vi.fn(impl);
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('список непустой', () => {
  it('разрешено ровно перечисленное', async () => {
    stubFetch(() => Promise.resolve(Response.json({ instruments: ['BTCUSD', 'ETHUSD'] })));

    const { access } = await getTenantConfig();

    expect(access.state).toBe('allowed');
    expect(isSymbolAllowed(access, 'BTCUSD')).toBe(true);
    expect(isSymbolAllowed(access, 'XAUUSD')).toBe(false);
  });
});

describe('список пуст', () => {
  it('это состояние empty, а не «списка нет»', async () => {
    stubFetch(() => Promise.resolve(Response.json({ instruments: [] })));

    expect((await getTenantConfig()).access).toEqual({ state: 'empty' });
    expect(console.error).not.toHaveBeenCalled();
  });

  it('РАСТЯЖКА: ничего не разрешено', async () => {
    stubFetch(() => Promise.resolve(Response.json({ instruments: [] })));

    const { access } = await getTenantConfig();

    // Прежде это работало «правильно» случайно: `new Set([])` ничего не
    // пропускал как побочное свойство пустого множества. Теперь это
    // решение, и мутация «вернуть fail-open на пустом списке» его красит.
    for (const symbol of ['BTCUSD', 'ETHUSD', 'XAUUSD', 'EURUSD', 'AAPL']) {
      expect(isSymbolAllowed(access, symbol)).toBe(false);
    }
  });
});

describe('CMS недоступна', () => {
  it('соединение отклонено → unavailable:network, граница закрыта, в логе крик', async () => {
    stubFetch(() => Promise.reject(new Error('ECONNREFUSED')));

    const { access } = await getTenantConfig();

    expect(access).toEqual({ state: 'unavailable', reason: 'network' });
    expect(isSymbolAllowed(access, 'BTCUSD')).toBe(false);
    expect(console.error).toHaveBeenCalled();
  });

  it('503 → unavailable:http-error', async () => {
    stubFetch(() => Promise.resolve(new Response('', { status: 503 })));

    expect((await getTenantConfig()).access).toEqual({
      state: 'unavailable',
      reason: 'http-error',
    });
  });

  it('CMS_API_URL не задан → unavailable:not-configured, в сеть не ходим', async () => {
    vi.stubEnv('CMS_API_URL', '');
    const fetchMock = stubFetch(() => Promise.reject(new Error('сети быть не должно')));

    const { access } = await getTenantConfig();

    expect(access).toEqual({ state: 'unavailable', reason: 'not-configured' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe('CMS ответила, но про инструменты ничего не сказала', () => {
  it.each([
    ['поля нет вовсе', {}],
    ['поле не массив', { instruments: 'BTCUSD' }],
    ['поле null', { instruments: null }],
  ])('%s → unavailable:malformed, а НЕ empty', async (_name, body) => {
    stubFetch(() => Promise.resolve(Response.json(body)));

    expect((await getTenantConfig()).access).toEqual({
      state: 'unavailable',
      reason: 'malformed',
    });
  });
});

describe('механизм границы', () => {
  it('РАСТЯЖКА: разрешает ТОЛЬКО state === allowed', () => {
    for (const access of ALL_STATES) {
      expect(isSymbolAllowed(access, 'BTCUSD')).toBe(access.state === 'allowed');
    }
  });

  it('РАСТЯЖКА: «пусто» и «недоступно» различимы, хотя запрещают одинаково', async () => {
    stubFetch(() => Promise.resolve(Response.json({ instruments: [] })));
    const empty = (await getTenantConfig()).access;
    stubFetch(() => Promise.resolve(new Response('', { status: 500 })));
    const down = (await getTenantConfig()).access;

    expect(empty.state).not.toBe(down.state);
    expect(isSymbolAllowed(empty, 'BTCUSD')).toBe(isSymbolAllowed(down, 'BTCUSD'));
  });
});

describe('стартовый демо-баланс: отказ вместо умолчания (Р-040)', () => {
  it('CMS назвала сумму → берём её', async () => {
    stubFetch(() =>
      Promise.resolve(Response.json({ demoStartBalanceCents: 500_000, instruments: [] })),
    );

    expect(await getTenantStartBalance()).toEqual({ state: 'set', cents: 500_000 });
  });

  it('CMS ответила null → `unset`, и это НЕ сумма', async () => {
    stubFetch(() =>
      Promise.resolve(Response.json({ demoStartBalanceCents: null, instruments: [] })),
    );

    // Открыть демо-счёт на сумму, которую никто не назначал, хуже, чем не
    // открыть: за неё никто не отвечает, а терминал читает тот же конфиг.
    expect(await getTenantStartBalance()).toEqual({ state: 'unset' });
  });

  it('CMS недоступна → `unavailable`, и это отличимо от «не задан»', async () => {
    stubFetch(() => Promise.reject(new Error('ECONNREFUSED')));

    // Два отказа запрещают одинаково, а чинятся в разных местах: первый —
    // полем карточки сайта, второй — соседом или сетью.
    expect(await getTenantStartBalance()).toEqual({ state: 'unavailable', reason: 'network' });
  });

  it('мусор в поле → `unavailable:malformed`, а не ноль и не умолчание', async () => {
    stubFetch(() =>
      Promise.resolve(Response.json({ demoStartBalanceCents: 'NaN', instruments: [] })),
    );

    // «Успешный разбор не означает пригодного значения»: `Number('NaN')`
    // разбирается, а дальше превращается в ноль. Ноль здесь — счёт без денег.
    expect(await getTenantStartBalance()).toEqual({ state: 'unavailable', reason: 'malformed' });
  });

  it('баланс разбирается независимо от границы доступа', async () => {
    stubFetch(() => Promise.resolve(Response.json({ demoStartBalanceCents: 777_000 })));

    const config = await getTenantConfig();

    expect(config.access.state).toBe('unavailable');
    expect(config.startBalance).toEqual({ state: 'set', cents: 777_000 });
  });

  it('РАСТЯЖКА: ни одно состояние конфига не даёт умолчания legacy', async () => {
    const bodies: unknown[] = [
      { demoStartBalanceCents: null, instruments: [] },
      { demoStartBalanceCents: 'NaN', instruments: [] },
      { instruments: [] },
    ];

    for (const body of bodies) {
      stubFetch(() => Promise.resolve(Response.json(body)));
      const balance = await getTenantStartBalance();

      expect(balance.state).not.toBe('set');
      expect(balance).not.toEqual({ state: 'set', cents: LEGACY_DEFAULT });
    }

    stubFetch(() => Promise.reject(new Error('ECONNREFUSED')));
    expect((await getTenantStartBalance()).state).toBe('unavailable');
  });
});

describe('кабинет вызывает границу со своими параметрами', () => {
  it('ключ доставки и окно ревалидации доходят до запроса', async () => {
    vi.stubEnv('CMS_API_KEY', 'secret');
    const mock = stubFetch(() => Promise.resolve(Response.json({ instruments: [] })));

    await getTenantConfig();

    const [url, init] = (mock.mock.calls[0] as unknown[]) as [
      string,
      RequestInit & { next?: { revalidate?: number } },
    ];
    expect(url).toBe('http://cms.test/cms/sites/apex-ru');
    expect((init.headers as Record<string, string>)['X-API-Key']).toBe('secret');
    expect(init.next?.revalidate).toBe(300);
  });
});
