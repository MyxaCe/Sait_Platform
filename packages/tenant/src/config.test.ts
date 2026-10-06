import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchTenantConfig } from './config';

/**
 * Чтение конфига тенанта — проверка СВЯЗКИ, а не единицы.
 *
 * Разница измерена у соседей и у нас: мутация «правило не вызывается»
 * красит ноль модульных тестов, потому что функция-то исправна. Здесь
 * проверяется путь целиком — ответ источника → разбор → решение границы,
 * — и мутация «срок годности не применяется» красит именно этот файл.
 *
 * Мутации, от которых набор обязан покраснеть (прогнаны, см. ADR-030):
 *   M1 `readAccess`: пустой список → fail-open;
 *   M2 `isSymbolAllowed` разрешает при `state !== 'allowed'`;
 *   M3 отсутствующее `instruments` считается пустым списком;
 *   M4 `readStartBalance`: `null` → умолчание legacy;
 *   M5 `readStartBalance` через `Number()` вместо строгого разбора;
 *   M6 `applyListExpiry` продолжает по последнему известному;
 *   M7 `readListExpiry` отсчитывает окно от «сейчас»;
 *   M8 `fetchTenantConfig` не вызывает `applyListExpiry` вовсе;
 *   M9 недоступность перестаёт кричать в лог.
 */

const ORIGIN = Date.parse('2026-10-06T12:00:00Z');
const BASE = { baseUrl: 'http://cms.test', slug: 'apex-ru' };

function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  const mock = vi.fn(impl);
  vi.stubGlobal('fetch', mock);
  return mock;
}

/** Ответ источника, который о сроке годности молчит, — как сегодня. */
function silent(body: unknown, init: ResponseInit = {}) {
  return Promise.resolve(Response.json(body, init));
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('источник ответил', () => {
  it('непустой список и сумма — оба поля разобраны', async () => {
    stubFetch(() => silent({ instruments: ['BTCUSD'], demoStartBalanceCents: 500_000 }));

    const config = await fetchTenantConfig(BASE);

    expect(config.access.state).toBe('allowed');
    expect(config.startBalance).toEqual({ state: 'set', cents: 500_000 });
  });

  it('поля разбираются независимо: сломанный список не отменяет сумму', async () => {
    stubFetch(() => silent({ demoStartBalanceCents: 777_000 }));

    const config = await fetchTenantConfig(BASE);

    expect(config.access).toEqual({ state: 'unavailable', reason: 'malformed' });
    expect(config.startBalance).toEqual({ state: 'set', cents: 777_000 });
  });

  it('сумма не задана, список цел — отказ только по сумме', async () => {
    stubFetch(() => silent({ instruments: ['BTCUSD'], demoStartBalanceCents: null }));

    const config = await fetchTenantConfig(BASE);

    expect(config.access.state).toBe('allowed');
    expect(config.startBalance).toEqual({ state: 'unset' });
  });

  it('пустой список — настройка владельца, в лог ошибок не идёт', async () => {
    stubFetch(() => silent({ instruments: [], demoStartBalanceCents: 1 }));

    const config = await fetchTenantConfig(BASE);

    expect(config.access).toEqual({ state: 'empty' });
    // Иначе дежурный пойдёт чинить исправное.
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe('источник недоступен', () => {
  it('CMS_API_URL не задан → not-configured у обоих полей, в сеть не ходим', async () => {
    const mock = stubFetch(() => silent({}));

    const config = await fetchTenantConfig({ ...BASE, baseUrl: undefined });

    expect(config.access).toEqual({ state: 'unavailable', reason: 'not-configured' });
    expect(config.startBalance).toEqual({ state: 'unavailable', reason: 'not-configured' });
    expect(mock).not.toHaveBeenCalled();
    // Ненастроенная CMS — конфигурация контура, а не происшествие.
    expect(console.error).not.toHaveBeenCalled();
  });

  it('503 → http-error, и это НЕ то же, что легла сеть', async () => {
    stubFetch(() => Promise.resolve(new Response('', { status: 503 })));

    const config = await fetchTenantConfig(BASE);

    expect(config.access).toEqual({ state: 'unavailable', reason: 'http-error' });
    expect(console.error).toHaveBeenCalled();
  });

  it('соединение отклонено → network, и в логе крик', async () => {
    stubFetch(() => Promise.reject(new Error('ECONNREFUSED')));

    const config = await fetchTenantConfig(BASE);

    expect(config.access).toEqual({ state: 'unavailable', reason: 'network' });
    // Фолбэк без алерта — скрытая авария (R-15).
    expect(console.error).toHaveBeenCalled();
  });

  it('мусор вместо JSON → network', async () => {
    stubFetch(() => Promise.resolve(new Response('<html>502</html>', { status: 200 })));

    expect((await fetchTenantConfig(BASE)).access.state).toBe('unavailable');
  });
});

describe('срок годности списка применяется на этом пути, а не только существует', () => {
  it('СВЯЗКА: названный источником срок истёк → граница закрыта', async () => {
    stubFetch(() =>
      silent(
        { instruments: ['BTCUSD'], demoStartBalanceCents: 1 },
        {
          headers: {
            date: new Date(ORIGIN).toUTCString(),
            'cache-control': 'public, max-age=60',
          },
        },
      ),
    );

    const config = await fetchTenantConfig({ ...BASE, now: () => ORIGIN + 61_000 });

    // Мутация M8 («`applyListExpiry` не вызывается») красит этот тест и не
    // красит ни одного модульного: функция-то исправна, её просто никто
    // не зовёт. Ради этой разницы проверка и написана на уровне связки.
    expect(config.access).toEqual({ state: 'unavailable', reason: 'expired' });
    expect(config.expiry).toEqual({ state: 'named', expiresAt: ORIGIN + 60_000 });
    expect(console.error).toHaveBeenCalled();
  });

  it('СВЯЗКА: тот же ответ внутри срока — граница открыта', async () => {
    stubFetch(() =>
      silent(
        { instruments: ['BTCUSD'], demoStartBalanceCents: 1 },
        {
          headers: {
            date: new Date(ORIGIN).toUTCString(),
            'cache-control': 'public, max-age=60',
          },
        },
      ),
    );

    const config = await fetchTenantConfig({ ...BASE, now: () => ORIGIN + 59_000 });

    expect(config.access.state).toBe('allowed');
  });

  it('СВЯЗКА: сегодняшний источник срока не называет — окно остаётся нашим', async () => {
    // Так отвечает legacy на `/v1/cms/sites/{slug}`: `no-store` и ничего
    // про срок действия разрешений. Ветка `named` на этом источнике не
    // исполняется — пункт Р-030 закрыт наполовину, и это записано.
    stubFetch(() =>
      silent({ instruments: ['BTCUSD'] }, { headers: { 'cache-control': 'no-store' } }),
    );

    const config = await fetchTenantConfig({ ...BASE, now: () => ORIGIN + 10 ** 9 });

    expect(config.expiry).toEqual({ state: 'unnamed' });
    expect(config.access.state).toBe('allowed');
  });
});

describe('параметры потребителя доходят до запроса', () => {
  it('ключ доставки уходит заголовком, адрес собран из базы и слага', async () => {
    const mock = stubFetch(() => silent({ instruments: [] }));

    await fetchTenantConfig({ ...BASE, baseUrl: 'http://cms.test/', apiKey: 'k' });

    const [url, init] = mock.mock.calls[0]!;
    expect(url).toBe('http://cms.test/cms/sites/apex-ru');
    expect((init.headers as Record<string, string>)['X-API-Key']).toBe('k');
  });

  it('кеширование — дело вызывающего: его параметры не теряются', async () => {
    const mock = stubFetch(() => silent({ instruments: [] }));

    await fetchTenantConfig({
      ...BASE,
      fetchInit: { next: { revalidate: 300, tags: ['cms:brand'] } } as RequestInit,
    });

    // Без этого вынос в пакет тихо отменил бы инвалидацию вебхуком у
    // витрины — правка, которая выглядит рефакторингом и меняет поведение.
    const init = mock.mock.calls[0]![1] as RequestInit & {
      next?: { revalidate?: number; tags?: string[] };
    };
    expect(init.next).toEqual({ revalidate: 300, tags: ['cms:brand'] });
    expect(init.signal).toBeDefined();
  });
});
