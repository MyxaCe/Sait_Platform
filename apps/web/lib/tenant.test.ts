import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accessNotice, getTenantAccess, isSymbolAllowed, type TenantAccess } from './tenant';

const ALL_STATES: TenantAccess[] = [
  { state: 'allowed', symbols: new Set(['BTCUSD']) },
  { state: 'empty' },
  { state: 'unavailable', reason: 'not-configured' },
  { state: 'unavailable', reason: 'http-error' },
  { state: 'unavailable', reason: 'network' },
  { state: 'unavailable', reason: 'malformed' },
];

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
  it('разрешено ровно перечисленное, остальное — нет', async () => {
    stubFetch(() => Promise.resolve(Response.json({ instruments: ['BTCUSD', 'ETHUSD'] })));

    const access = await getTenantAccess();

    expect(access.state).toBe('allowed');
    expect(isSymbolAllowed(access, 'BTCUSD')).toBe(true);
    expect(isSymbolAllowed(access, 'ETHUSD')).toBe(true);
    expect(isSymbolAllowed(access, 'XAUUSD')).toBe(false);
    expect(accessNotice(access)).toBeNull();
  });
});

describe('список пуст', () => {
  it('это СОСТОЯНИЕ empty, а не «списка нет»', async () => {
    stubFetch(() => Promise.resolve(Response.json({ instruments: [] })));

    const access = await getTenantAccess();

    expect(access).toEqual({ state: 'empty' });
    expect(console.error).not.toHaveBeenCalled();
  });

  it('РАСТЯЖКА: ничего не разрешено. Fail-open здесь был исходным дефектом', async () => {
    stubFetch(() => Promise.resolve(Response.json({ instruments: [] })));

    const access = await getTenantAccess();

    for (const symbol of ['BTCUSD', 'ETHUSD', 'XAUUSD', 'EURUSD', 'AAPL']) {
      expect(isSymbolAllowed(access, symbol)).toBe(false);
    }
  });

  it('объяснение есть и оно своё, не общее с «недоступно»', async () => {
    stubFetch(() => Promise.resolve(Response.json({ instruments: [] })));

    const notice = accessNotice(await getTenantAccess());

    expect(notice?.titleKey).toBe('accessEmptyTitle');
    expect(notice?.reason).toBeUndefined();
  });
});

describe('CMS недоступна', () => {
  it('соединение отклонено → unavailable:network, граница закрыта, в логе крик', async () => {
    const fetchMock = stubFetch(() => Promise.reject(new Error('ECONNREFUSED')));

    const access = await getTenantAccess();

    expect(fetchMock).toHaveBeenCalled();
    expect(access).toEqual({ state: 'unavailable', reason: 'network' });
    expect(isSymbolAllowed(access, 'BTCUSD')).toBe(false);
    expect(console.error).toHaveBeenCalled();
  });

  it('таймаут → unavailable:network (сайт не ждёт соседа дольше бюджета)', async () => {
    stubFetch(
      () =>
        new Promise((_, reject) =>
          setTimeout(() => reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), 5),
        ),
    );

    expect(await getTenantAccess()).toEqual({ state: 'unavailable', reason: 'network' });
  });

  it('503 → unavailable:http-error, и это НЕ то же, что сеть легла', async () => {
    stubFetch(() => Promise.resolve(new Response('unavailable', { status: 503 })));

    const access = await getTenantAccess();

    expect(access).toEqual({ state: 'unavailable', reason: 'http-error' });
    expect(isSymbolAllowed(access, 'BTCUSD')).toBe(false);
  });

  it('CMS_API_URL не задан → unavailable:not-configured, в сеть не ходим', async () => {
    vi.stubEnv('CMS_API_URL', '');
    const fetchMock = stubFetch(() => Promise.reject(new Error('сети быть не должно')));

    const access = await getTenantAccess();

    expect(access).toEqual({ state: 'unavailable', reason: 'not-configured' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(isSymbolAllowed(access, 'BTCUSD')).toBe(false);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('у витрины НЕТ standalone-режима: незаданный CMS_API_URL не открывает всё', async () => {
    vi.stubEnv('CMS_API_URL', '');

    const access = await getTenantAccess();

    expect(isSymbolAllowed(access, 'BTCUSD')).toBe(false);
  });
});

describe('CMS ответила, но про инструменты ничего не сказала', () => {
  it.each([
    ['поля нет вовсе', {}],
    ['поле не массив', { instruments: 'BTCUSD' }],
    ['поле null', { instruments: null }],
  ])('%s → unavailable:malformed, а НЕ empty', async (_name, body) => {
    stubFetch(() => Promise.resolve(Response.json(body)));

    const access = await getTenantAccess();

    expect(access).toEqual({ state: 'unavailable', reason: 'malformed' });
    expect(console.error).toHaveBeenCalled();
  });

  it('мусор вместо JSON → unavailable:network', async () => {
    stubFetch(() => Promise.resolve(new Response('<html>502</html>', { status: 200 })));

    expect((await getTenantAccess()).state).toBe('unavailable');
  });
});

describe('механизм границы', () => {
  it('РАСТЯЖКА: разрешает ТОЛЬКО state === allowed', () => {
    for (const access of ALL_STATES) {
      const allowed = isSymbolAllowed(access, 'BTCUSD');
      expect(allowed).toBe(access.state === 'allowed');
    }
  });

  it('РАСТЯЖКА: «пусто» и «недоступно» различимы, хотя запрещают одинаково', async () => {
    stubFetch(() => Promise.resolve(Response.json({ instruments: [] })));
    const empty = await getTenantAccess();
    stubFetch(() => Promise.resolve(new Response('', { status: 500 })));
    const down = await getTenantAccess();

    expect(empty.state).not.toBe(down.state);
    expect(isSymbolAllowed(empty, 'BTCUSD')).toBe(isSymbolAllowed(down, 'BTCUSD'));
    expect(accessNotice(empty)?.titleKey).not.toBe(accessNotice(down)?.titleKey);
  });

  it('РАСТЯЖКА: каждое закрытое состояние имеет объяснение, открытое — не имеет', () => {
    for (const access of ALL_STATES) {
      const notice = accessNotice(access);
      if (access.state === 'allowed') {
        expect(notice).toBeNull();
      } else {
        expect(notice).not.toBeNull();
        expect(notice!.titleKey).toBeTruthy();
        expect(notice!.textKey).toBeTruthy();
        expect(notice!.stripKey).toBeTruthy();
        expect(notice!.state).toBe(access.state);
      }
    }
  });

  it('РАСТЯЖКА: у каждой причины недоступности свой машинный код на экране', () => {
    const reasons = ALL_STATES.filter((a) => a.state === 'unavailable').map(
      (a) => accessNotice(a)?.reason,
    );
    expect(new Set(reasons).size).toBe(reasons.length);
    expect(reasons).not.toContain(undefined);
  });
});

describe('срок годности списка приходит от источника', () => {
  function withAge(ageSeconds: number, cacheControl: string) {
    const date = new Date(Date.now() - ageSeconds * 1000).toUTCString();
    return () =>
      Promise.resolve(
        Response.json({ instruments: ['BTCUSD'] }, { headers: { date, 'cache-control': cacheControl } }),
      );
  }

  it('СВЯЗКА: источник назвал 60 с, ответу 120 с → граница закрыта, причина `expired`', async () => {
    stubFetch(withAge(120, 'public, max-age=60'));

    const access = await getTenantAccess();

    expect(access).toEqual({ state: 'unavailable', reason: 'expired' });
    expect(isSymbolAllowed(access, 'BTCUSD')).toBe(false);
    expect(accessNotice(access)?.reason).toBe('expired');
  });

  it('тот же ответ внутри срока — граница открыта', async () => {
    stubFetch(withAge(5, 'public, max-age=60'));

    expect(isSymbolAllowed(await getTenantAccess(), 'BTCUSD')).toBe(true);
  });

  it('сегодняшний источник срока не называет (`no-store`) → действует наше окно', async () => {
    stubFetch(withAge(10 ** 6, 'no-store'));

    expect(isSymbolAllowed(await getTenantAccess(), 'BTCUSD')).toBe(true);
  });
});

describe('витрина вызывает границу со своими параметрами', () => {
  it('теги инвалидации карточки сайта доходят до запроса', async () => {
    const mock = stubFetch(() => Promise.resolve(Response.json({ instruments: [] })));

    await getTenantAccess();

    const init = (mock.mock.calls[0] as unknown[])[1] as {
      next?: { tags?: string[]; revalidate?: number };
    };
    expect(init.next?.tags).toEqual(['cms:brand', 'cms:brand:apex-ru']);
    expect(init.next?.revalidate).toBe(300);
  });
});
