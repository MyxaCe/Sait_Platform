import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getTenantConfig,
  getTenantStartBalanceCents,
  isSymbolAllowed,
  type TenantAccess,
} from './tenant';

/**
 * Граница доступа кабинета к инструментам — решение штаба Р-025.
 *
 * **Парная копия `apps/web/lib/tenant.test.ts`.** Таблица «вход → состояние»
 * здесь дословно та же: расхождение двух реализаций на одних и тех же
 * данных и было дефектом Р-025 (витрина на пустом списке показывала всё,
 * кабинет прятал модуль), и держать копии в соответствии должен тест, а не
 * память. Любое расхождение красит один из двух файлов.
 *
 * Отдельно проверяется второе поле конфига — стартовый демо-баланс. У него
 * политика ПРОТИВОПОЛОЖНАЯ: умолчание законно, потому что параметр удобства
 * ничего не разрешает. Два поля одного ответа живут по разным правилам, и
 * тест это фиксирует, чтобы их не «привели к единообразию».
 */

const ALL_STATES: TenantAccess[] = [
  { state: 'allowed', symbols: new Set(['BTCUSD']) },
  { state: 'empty' },
  { state: 'unavailable', reason: 'not-configured' },
  { state: 'unavailable', reason: 'http-error' },
  { state: 'unavailable', reason: 'network' },
  { state: 'unavailable', reason: 'malformed' },
];

const DEFAULT_BALANCE = 1_000_000;

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

describe('стартовый демо-баланс живёт по ДРУГОМУ правилу', () => {
  it('CMS отдала значение → берём его', async () => {
    stubFetch(() => Promise.resolve(Response.json({ demoStartBalanceCents: 500_000, instruments: [] })));

    expect(await getTenantStartBalanceCents()).toBe(500_000);
  });

  it('CMS недоступна → умолчание $10 000, и это НЕ fail-open', async () => {
    stubFetch(() => Promise.reject(new Error('ECONNREFUSED')));

    // Умолчание для демо-денег законно: параметр удобства ничего не
    // разрешает. Для allow-list такое же умолчание было бы разрешением —
    // отсюда разные политики у двух полей одного ответа.
    expect(await getTenantStartBalanceCents()).toBe(DEFAULT_BALANCE);
  });

  it('мусор в поле баланса → умолчание, а не NaN и не 0', async () => {
    stubFetch(() => Promise.resolve(Response.json({ demoStartBalanceCents: 'NaN', instruments: [] })));

    // «Успешный разбор не означает пригодного значения»: Number('NaN')
    // разбирается, а дальше превращается в ноль. Ноль здесь — счёт без денег.
    expect(await getTenantStartBalanceCents()).toBe(DEFAULT_BALANCE);
  });

  it('баланс приходит даже когда граница доступа закрыта', async () => {
    stubFetch(() => Promise.resolve(Response.json({ demoStartBalanceCents: 777_000 })));

    const config = await getTenantConfig();

    expect(config.access.state).toBe('unavailable');
    expect(config.demoStartBalanceCents).toBe(777_000);
  });
});
