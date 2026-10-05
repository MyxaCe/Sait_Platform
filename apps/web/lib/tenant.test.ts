import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accessNotice, getTenantAccess, isSymbolAllowed, type TenantAccess } from './tenant';

/**
 * Граница доступа витрины к инструментам (ADR-028) — решение штаба Р-025.
 *
 * Проверяется ТРИ состояния по отдельности, и в каждом два вопроса:
 * «что именно произошло» (состояния обязаны быть различимы) и «снята ли
 * граница» (нигде и никогда). Третий вопрос — «видно ли это человеку» —
 * закрыт `accessNotice`: исчерпывающий разбор, в котором каждому закрытому
 * состоянию соответствует своё объяснение.
 *
 * Мутации, от которых набор обязан покраснеть (прогнаны, см. ADR-029):
 *   1. `length === 0 → null` (fail-open на пустом списке — исходный дефект);
 *   2. `isSymbolAllowed` разрешает при `state !== 'allowed'`;
 *   3. отсутствующее `instruments` считается пустым списком;
 *   4. `empty` и `unavailable` снова сливаются в одно значение;
 *   5. недоступность границы перестаёт кричать в лог.
 */

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

/* ------------------------------------------------------------------ */
/* Состояние 1 — список непустой                                       */
/* ------------------------------------------------------------------ */

describe('список непустой', () => {
  it('разрешено ровно перечисленное, остальное — нет', async () => {
    stubFetch(() => Promise.resolve(Response.json({ instruments: ['BTCUSD', 'ETHUSD'] })));

    const access = await getTenantAccess();

    expect(access.state).toBe('allowed');
    expect(isSymbolAllowed(access, 'BTCUSD')).toBe(true);
    expect(isSymbolAllowed(access, 'ETHUSD')).toBe(true);
    // Символ вне списка не проходит — иначе граница не граница
    expect(isSymbolAllowed(access, 'XAUUSD')).toBe(false);
    // Граница открыта — объяснять нечего
    expect(accessNotice(access)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Состояние 2 — список пуст                                           */
/* ------------------------------------------------------------------ */

describe('список пуст', () => {
  it('это СОСТОЯНИЕ empty, а не «списка нет»', async () => {
    stubFetch(() => Promise.resolve(Response.json({ instruments: [] })));

    const access = await getTenantAccess();

    expect(access).toEqual({ state: 'empty' });
    // Пустой список — настройка владельца, а не инцидент: в лог ошибок
    // ему попадать незачем, иначе дежурный пойдёт чинить исправное
    expect(console.error).not.toHaveBeenCalled();
  });

  it('РАСТЯЖКА: ничего не разрешено. Fail-open здесь был исходным дефектом', async () => {
    stubFetch(() => Promise.resolve(Response.json({ instruments: [] })));

    const access = await getTenantAccess();

    // Ни один символ вселенной: до Р-025 пустой список давал `null`, и
    // витрина показывала ВСЁ. Мутация «вернуть fail-open на пустом
    // списке» красит именно этот тест.
    for (const symbol of ['BTCUSD', 'ETHUSD', 'XAUUSD', 'EURUSD', 'AAPL']) {
      expect(isSymbolAllowed(access, symbol)).toBe(false);
    }
  });

  it('объяснение есть и оно своё, не общее с «недоступно»', async () => {
    stubFetch(() => Promise.resolve(Response.json({ instruments: [] })));

    const notice = accessNotice(await getTenantAccess());

    expect(notice?.titleKey).toBe('accessEmptyTitle');
    expect(notice?.reason).toBeUndefined(); // причины нет: ничего не сломалось
  });
});

/* ------------------------------------------------------------------ */
/* Состояние 3 — CMS недоступна                                        */
/* ------------------------------------------------------------------ */

describe('CMS недоступна', () => {
  it('соединение отклонено → unavailable:network, граница закрыта, в логе крик', async () => {
    const fetchMock = stubFetch(() => Promise.reject(new Error('ECONNREFUSED')));

    const access = await getTenantAccess();

    expect(fetchMock).toHaveBeenCalled(); // сходили и узнали по факту
    expect(access).toEqual({ state: 'unavailable', reason: 'network' });
    expect(isSymbolAllowed(access, 'BTCUSD')).toBe(false);
    // Фолбэк без алерта — скрытая авария (R-15)
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
    // Ненастроенная CMS — конфигурация контура, а не происшествие: сигнал
    // для машины даёт отпечаток конфигурации /api/health (B-019)
    expect(console.error).not.toHaveBeenCalled();
  });

  it('у витрины НЕТ standalone-режима: незаданный CMS_API_URL не открывает всё', async () => {
    vi.stubEnv('CMS_API_URL', '');

    const access = await getTenantAccess();

    // У терминала «нет тенанта → полный список» законно: `?site=` не задан,
    // юрисдикции нет. Сайт — всегда витрина конкретного тенанта, и
    // «переменную забыли» это самый частый способ потерять границу.
    expect(isSymbolAllowed(access, 'BTCUSD')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Молчание источника — не пустой список                               */
/* ------------------------------------------------------------------ */

describe('CMS ответила, но про инструменты ничего не сказала', () => {
  it.each([
    ['поля нет вовсе', {}],
    ['поле не массив', { instruments: 'BTCUSD' }],
    ['поле null', { instruments: null }],
  ])('%s → unavailable:malformed, а НЕ empty', async (_name, body) => {
    stubFetch(() => Promise.resolve(Response.json(body)));

    const access = await getTenantAccess();

    // Умолчание — утверждение о том, чего мы не знаем. «Поля нет» значит
    // «источник ничего не сказал», а не «разрешено ничего»: первое чинят
    // в контракте CMS, второе — выбором инструментов владельцем.
    expect(access).toEqual({ state: 'unavailable', reason: 'malformed' });
    expect(console.error).toHaveBeenCalled();
  });

  it('мусор вместо JSON → unavailable:network', async () => {
    stubFetch(() => Promise.resolve(new Response('<html>502</html>', { status: 200 })));

    expect((await getTenantAccess()).state).toBe('unavailable');
  });
});

/* ------------------------------------------------------------------ */
/* Растяжки на сам механизм                                            */
/* ------------------------------------------------------------------ */

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
        // Исчезновение без объяснения запрещено: нет состояния, в котором
        // граница закрыта, а сказать нечего (Р-025, п. 3)
        expect(notice).not.toBeNull();
        expect(notice!.titleKey).toBeTruthy();
        expect(notice!.textKey).toBeTruthy();
        expect(notice!.stripKey).toBeTruthy();
        // Состояние едет в разметку как есть, а не выводится из наличия
        // причины: «причины нет → значит пусто» снова склеило бы два
        // состояния, теперь уже в вёрстке
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
