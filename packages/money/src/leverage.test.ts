import { describe, expect, it } from 'vitest';
import type { Queryable } from './db';
import {
  clientsOfPortfolio,
  leverageChanges,
  pushLeverageToTerminal,
  readTerminalLeverage,
  readTerminalLeverageTables,
  sameTerminalLeverage,
  terminalLeverageOf,
  TERMINAL_INSTRUMENT_CLASS,
  type TerminalLeverage,
} from './leverage';
import { createTerminalMoneyClient } from './terminal-money';
import { FakeTerminal } from './testing';

interface State {
  users: string[];
  clients: Record<string, { portfolio_key: string; override_leverage: number | null }>;
  portfolios: { key: string; base_leverage: number; is_default: boolean }[];
  classOverrides: { portfolio_key: string; instrument_class: string; leverage: number }[];
}

function fakeDb(state: State): Queryable & { sql: string[] } {
  const sql: string[] = [];
  return {
    sql,
    async query(text: string, params: unknown[] = []) {
      sql.push(text);
      if (/FROM users u\s+LEFT JOIN client_leverage cl[\s\S]*ANY\(\$1::text\[\]\)/.test(text)) {
        const ids = params[0] as string[];
        return {
          rows: state.users
            .filter((u) => ids.includes(u))
            .map((u) => ({
              user_id: u,
              portfolio_key: state.clients[u]?.portfolio_key ?? null,
              override_leverage: state.clients[u]?.override_leverage ?? null,
            })),
        };
      }
      if (/FROM leverage_portfolios$/.test(text.trim())) {
        return { rows: state.portfolios.map((p) => ({ ...p, title: p.key })) };
      }
      if (/FROM leverage_portfolio_class_overrides$/.test(text.trim())) {
        return { rows: state.classOverrides };
      }
      if (/WHERE cl.portfolio_key = \$1[\s\S]*cl.user_id IS NULL/.test(text)) {
        const key = params[0] as string;
        const isDefault = state.portfolios.some((p) => p.key === key && p.is_default);
        return {
          rows: state.users
            .filter((u) => (state.clients[u] ? state.clients[u]!.portfolio_key === key : isDefault))
            .map((u) => ({ user_id: u })),
        };
      }
      throw new Error(`неизвестный SQL в тесте: ${text}`);
    },
  };
}

function seed(): State {
  return {
    users: ['u-default', 'u-pro', 'u-override'],
    clients: {
      'u-pro': { portfolio_key: 'pro', override_leverage: null },
      'u-override': { portfolio_key: 'standard', override_leverage: 200 },
    },
    portfolios: [
      { key: 'standard', base_leverage: 20, is_default: true },
      { key: 'pro', base_leverage: 50, is_default: false },
    ],
    classOverrides: [{ portfolio_key: 'standard', instrument_class: 'crypto', leverage: 10 }],
  };
}

describe('readTerminalLeverage — закон Р-446 на базе', () => {
  it('крипто-override портфеля действует на все инструменты терминала; override клиента — выше всего', async () => {
    expect(TERMINAL_INSTRUMENT_CLASS).toBe('crypto');
    const m = await readTerminalLeverage(fakeDb(seed()), ['u-default', 'u-pro', 'u-override']);
    expect(m.get('u-default')).toBe(10);
    expect(m.get('u-pro')).toBe(50);
    expect(m.get('u-override')).toBe(200);
  });

  it('нет строки и нет портфеля по умолчанию — плечо не выдумывается', async () => {
    const s = seed();
    s.portfolios = s.portfolios.map((p) => ({ ...p, is_default: false }));
    const m = await readTerminalLeverage(fakeDb(s), ['u-default', 'u-pro']);
    expect(m.has('u-default')).toBe(false);
    expect(m.get('u-pro')).toBe(50);
  });

  it('пустой список — без запросов', async () => {
    const db = fakeDb(seed());
    expect((await readTerminalLeverage(db, [])).size).toBe(0);
    expect(db.sql).toHaveLength(0);
  });

  it('клиенты портфеля по умолчанию — включая тех, у кого строки нет', async () => {
    const db = fakeDb(seed());
    expect(await clientsOfPortfolio(db, 'standard')).toEqual(['u-default', 'u-override']);
    expect(await clientsOfPortfolio(db, 'pro')).toEqual(['u-pro']);
  });

  it('изменения — только где действующее плечо сдвинулось', () => {
    const before = new Map([
      ['a', L(10)],
      ['b', L(50)],
      ['d', L(20, { forex: 100 })],
    ]);
    const after = new Map([
      ['a', L(10)],
      ['b', L(100)],
      ['c', L(20)],
      ['d', L(20, { forex: 50 })],
    ]);
    expect(leverageChanges(before, after)).toEqual([
      { userId: 'b', before: L(50), after: L(100) },
      { userId: 'c', before: null, after: L(20) },
      { userId: 'd', before: L(20, { forex: 100 }), after: L(20, { forex: 50 }) },
    ]);
  });

  it('таблица по категориям: override категории, иначе базовое; override клиента — одно число на всё', async () => {
    const s = seed();
    s.classOverrides.push(
      { portfolio_key: 'standard', instrument_class: 'forex', leverage: 100 },
      { portfolio_key: 'pro', instrument_class: 'metals', leverage: 25 },
      { portfolio_key: 'pro', instrument_class: 'legacy-junk', leverage: 3 },
    );
    const m = await readTerminalLeverageTables(fakeDb(s), ['u-default', 'u-pro', 'u-override']);
    expect(m.get('u-default')).toEqual({ leverage: 10, base: 20, classes: { crypto: 10, forex: 100 } });
    expect(m.get('u-pro')).toEqual({ leverage: 50, base: 50, classes: { metals: 25 } });
    expect(m.get('u-override')).toEqual({ leverage: 200, base: 200, classes: {} });
    expect((await readTerminalLeverage(fakeDb(s), ['u-default'])).get('u-default')).toBe(10);
  });

  it('сравнение таблиц не зависит от порядка ключей', () => {
    expect(sameTerminalLeverage(L(20, { forex: 1, crypto: 2 }), L(20, { crypto: 2, forex: 1 }))).toBe(true);
    expect(sameTerminalLeverage(L(20, { forex: 1 }), L(20, { forex: 1, crypto: 2 }))).toBe(false);
    expect(
      terminalLeverageOf({ key: 'p', title: 'p', baseLeverage: 30, classOverrides: { energy: 5 } }, null),
    ).toEqual({ leverage: 30, base: 30, classes: { energy: 5 } });
  });
});

function L(n: number, classes: Record<string, number> = {}): TerminalLeverage {
  return { leverage: classes.crypto ?? n, base: n, classes };
}

describe('pushLeverageToTerminal — fail-closed', () => {
  const META = { reason: 'портфель Pro', operator: 'admin', externalRef: 'adm:1' };

  it('оба счёта клиента; неоткрытый счёт — не ошибка', async () => {
    const t = new FakeTerminal();
    t.opened = new Set(['u1:demo']);
    const out = await pushLeverageToTerminal(t, [{ userId: 'u1', before: L(20), after: L(50) }], META);
    expect(out).toEqual({
      ok: true,
      notOpened: 1,
      applied: [
        { userId: 'u1', kind: 'demo', leverage: 50, previous: 20, previousClasses: null, changed: true, seq: 1 },
      ],
    });
    expect(t.leverageCalls.map((c) => `${c.kind}:${c.leverage}`)).toEqual(['demo:50', 'real:50']);
  });

  it('таблица уходит вместе с числом; откат на новом шлюзе возвращает и таблицу', async () => {
    const t = new FakeTerminal();
    t.supportsClasses = true;
    t.leverage.set('u1:demo', 20);
    t.classes.set('u1:demo', { crypto: 10 });
    t.next = ['ok', 'ok', 'unavailable', 'ok', 'ok'];
    const after = L(30, { crypto: 5, forex: 100 });
    const out = await pushLeverageToTerminal(
      t,
      [
        { userId: 'u1', before: L(20, { crypto: 10 }), after },
        { userId: 'u2', before: null, after },
      ],
      META,
    );
    expect(out).toMatchObject({ ok: false, reason: 'terminalUnavailable', compensationFailed: 0 });
    expect(t.leverageCalls[0]).toMatchObject({ leverage: 5, base: 30, classes: { crypto: 5, forex: 100 } });
    expect(t.leverage.get('u1:demo')).toBe(20);
    expect(t.classes.get('u1:demo')).toEqual({ crypto: 10 });
    expect(t.classes.get('u1:real')).toEqual({});
  });

  it('отказ посреди пачки — уже применённое откатывается к плечу «до» терминала', async () => {
    const t = new FakeTerminal();
    t.leverage.set('u1:demo', 30);
    t.next = ['ok', 'ok', 'account_quarantined'];
    const out = await pushLeverageToTerminal(
      t,
      [
        { userId: 'u1', before: L(20), after: L(50) },
        { userId: 'u2', before: L(20), after: L(50) },
      ],
      META,
    );
    expect(out).toEqual({
      ok: false,
      reason: 'terminalRefused',
      code: 'account_quarantined',
      userId: 'u2',
      compensationFailed: 0,
    });
    expect(t.leverage.get('u1:demo')).toBe(30);
    expect(t.leverage.get('u1:real')).toBe(20);
    const rollbacks = t.leverageCalls.filter((c) => c.reason.startsWith('откат'));
    expect(rollbacks.map((c) => `${c.userId}:${c.kind}:${c.leverage}`)).toEqual(['u1:real:20', 'u1:demo:30']);
  });

  it('недоступность — тот же откат; не дошедший откат назван', async () => {
    const t = new FakeTerminal();
    t.next = ['ok', 'unavailable', 'unavailable'];
    const out = await pushLeverageToTerminal(t, [{ userId: 'u1', before: L(20), after: L(50) }], META);
    expect(out).toEqual({ ok: false, reason: 'terminalUnavailable', userId: 'u1', compensationFailed: 1 });
  });

  it('исключение транспорта — «недоступно», а не падение', async () => {
    const out = await pushLeverageToTerminal(
      {
        setLeverage: async () => {
          throw new Error('boom');
        },
      },
      [{ userId: 'u1', before: L(20), after: L(50) }],
      META,
    );
    expect(out).toMatchObject({ ok: false, reason: 'terminalUnavailable' });
  });
});

describe('клиент: POST …/{kind}/leverage', () => {
  function client(respond: () => Response) {
    const seen: { url: string; init: RequestInit }[] = [];
    const c = createTerminalMoneyClient({
      baseUrl: 'http://terminal:8080',
      token: 'secret',
      tenant: 'apex-ru',
      fetchImpl: (async (url: string, init: RequestInit) => {
        seen.push({ url, init });
        return respond();
      }) as unknown as typeof fetch,
    });
    return { c, seen };
  }
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const BODY = { leverage: 50, reason: 'r', operator: 'admin' };

  it('маршрут, тело, разбор ответа', async () => {
    const { c, seen } = client(() =>
      json(200, { leverage: 50, previous_leverage: 20, changed: true, seq: 9, account_kind: 'demo' }),
    );
    expect(await c.setLeverage('u', BODY, 'demo')).toEqual({
      state: 'ok',
      leverage: 50,
      previousLeverage: 20,
      previousClasses: null,
      changed: true,
      seq: 9,
    });
    expect(seen[0]!.url).toBe('http://terminal:8080/internal/sites/apex-ru/users/u/demo/leverage');
    expect(JSON.parse(seen[0]!.init.body as string)).toEqual(BODY);
  });

  it('новый шлюз отвечает прежней таблицей — она разбирается', async () => {
    const { c } = client(() =>
      json(200, { leverage: 5, previous_leverage: 20, previous_leverage_classes: { crypto: 10 }, changed: true, seq: 3 }),
    );
    const out = await c.setLeverage('u', { ...BODY, leverage_base: 30, leverage_classes: { crypto: 5 } }, 'demo');
    expect(out).toMatchObject({ state: 'ok', previousClasses: { crypto: 10 } });
  });

  it('404 account_not_opened — счёта нет; 404 без кода — маршрута нет (недоступно)', async () => {
    expect(await client(() => json(404, { error: 'account_not_opened' })).c.setLeverage('u', BODY, 'real')).toEqual({
      state: 'not-opened',
    });
    expect(await client(() => new Response(null, { status: 404 })).c.setLeverage('u', BODY, 'real')).toEqual({
      state: 'unavailable',
      reason: 'malformed',
    });
  });

  it('отказ по существу, ошибка доступа, 5xx', async () => {
    expect(await client(() => json(400, { error: 'invalid_leverage' })).c.setLeverage('u', BODY, 'real')).toEqual({
      state: 'refused',
      code: 'invalid_leverage',
      status: 400,
    });
    expect(
      await client(() => json(403, { error: 'invalid_internal_token' })).c.setLeverage('u', BODY, 'real'),
    ).toEqual({ state: 'unavailable', reason: 'auth' });
    expect(await client(() => json(503, { error: 'x' })).c.setLeverage('u', BODY, 'real')).toEqual({
      state: 'unavailable',
      reason: 'http-error',
    });
  });

  it('список счетов несёт плечо', async () => {
    const { c } = client(() =>
      json(200, {
        accounts: [{ account_kind: 'real', opened: true, leverage: 10, trading_frozen: false }],
      }),
    );
    const out = await c.accounts('u');
    expect(out.state === 'ok' && out.accounts[0]!.leverage).toBe(10);
  });
});
