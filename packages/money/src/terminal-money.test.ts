import { describe, expect, it } from 'vitest';
import { createTerminalMoneyClient } from './terminal-money';

/** Ни одного сетевого вызова: `fetch` подменён. */
function client(
  respond: (url: string, init: RequestInit) => Promise<Response> | Response,
  over: { baseUrl?: string; token?: string; tenant?: string } = {},
) {
  const seen: { url: string; init: RequestInit }[] = [];
  const c = createTerminalMoneyClient({
    baseUrl: 'baseUrl' in over ? over.baseUrl : 'http://terminal:8080/',
    token: 'token' in over ? over.token : 'secret',
    tenant: 'tenant' in over ? over.tenant : 'apex-ru',
    fetchImpl: (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return respond(url, init);
    }) as unknown as typeof fetch,
  });
  return { c, seen };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const BODY = { amount_minor: 1234, external_ref: 'tron:abc', operator: 'system:chain-watcher', reason: 'r' };

describe('клиент internal-маршрутов терминала', () => {
  it('deposit: маршрут sites/{tenant}/users/{id}/real, X-Internal-Token, USD, initiator', async () => {
    const { c, seen } = client(() =>
      json(200, { balance_minor: 5000, free_margin_minor: 4000, seq: 7, replayed: false, account_id: 'acc' }),
    );
    const out = await c.deposit('user-1', BODY);

    expect(out).toEqual({ state: 'ok', balanceMinor: 5000, freeMarginMinor: 4000, seq: 7, replay: false });
    expect(seen[0]!.url).toBe('http://terminal:8080/internal/sites/apex-ru/users/user-1/real/deposit');
    const headers = seen[0]!.init.headers as Record<string, string>;
    expect(headers['x-internal-token']).toBe('secret');
    expect(JSON.parse(seen[0]!.init.body as string)).toEqual({
      amount_minor: 1234,
      currency: 'USD',
      external_ref: 'tron:abc',
      initiator: 'system:chain-watcher',
      reason: 'r',
    });
  });

  it('withdraw: отказ по существу различим (нет маржи)', async () => {
    const { c, seen } = client(() => json(409, { error: 'insufficient_free_margin', free_margin_minor: 10 }));
    expect(await c.withdraw('u', BODY)).toMatchObject({ state: 'refused', code: 'insufficient_free_margin', status: 409 });
    expect(seen[0]!.url).toMatch(/\/internal\/sites\/apex-ru\/users\/u\/real\/withdraw$/);
  });

  it('повтор external_ref (200 replayed:true) — применено, помечено как повтор', async () => {
    const { c } = client(() => json(200, { balance_minor: 1, seq: 3, replayed: true }));
    expect(await c.deposit('u', BODY)).toMatchObject({ state: 'ok', seq: 3, replay: true });
  });

  it('ошибки доступа (401/403 токен, 404 без кода) — «недоступно», а не отказ по деньгам', async () => {
    expect(await client(() => json(401, { error: 'missing_internal_token' })).c.deposit('u', BODY)).toEqual({
      state: 'unavailable',
      reason: 'auth',
    });
    expect(await client(() => json(403, { error: 'invalid_internal_token' })).c.withdraw('u', BODY)).toEqual({
      state: 'unavailable',
      reason: 'auth',
    });
    expect(await client(() => new Response('', { status: 404 })).c.withdraw('u', BODY)).toEqual({
      state: 'unavailable',
      reason: 'malformed',
    });
    // а 403 account_frozen — отказ по существу
    expect(await client(() => json(403, { error: 'account_frozen' })).c.withdraw('u', BODY)).toMatchObject({
      state: 'refused',
      code: 'account_frozen',
    });
  });

  it('accounts: разбор демо и реального, денежные поля могут быть null', async () => {
    const { c, seen } = client(() =>
      json(200, {
        accounts: [
          { account_kind: 'demo', account_id: 'd', opened: true, currency: 'USD', balance_minor: 1000000, equity_minor: 1000500, free_margin_minor: 900000, used_margin_minor: 100500, open_positions: 2, trading_frozen: false },
          { account_kind: 'real', account_id: null, opened: false, currency: 'USD', balance_minor: null, equity_minor: null, free_margin_minor: null, used_margin_minor: null, open_positions: null, trading_frozen: false },
          { account_kind: 'weird' },
        ],
      }),
    );
    const out = await c.accounts('u');
    expect(seen[0]!.init.method).toBe('GET');
    expect(seen[0]!.url).toMatch(/\/internal\/sites\/apex-ru\/users\/u\/accounts$/);
    expect(out.state === 'ok' && out.accounts.map((a) => [a.kind, a.equityMinor])).toEqual([
      ['demo', 1000500],
      ['real', null],
    ]);
  });

  it('5xx / сеть / мусор — «исход неизвестен», не отказ', async () => {
    expect(await client(() => json(503, {})).c.deposit('u', BODY)).toEqual({
      state: 'unavailable',
      reason: 'http-error',
    });
    expect(
      await client(() => {
        throw new TypeError('fetch failed');
      }).c.deposit('u', BODY),
    ).toEqual({ state: 'unavailable', reason: 'network' });
    expect(await client(() => json(200, { nope: 1 })).c.deposit('u', BODY)).toEqual({
      state: 'unavailable',
      reason: 'malformed',
    });
    expect(await client(() => json(400, {})).c.deposit('u', BODY)).toEqual({
      state: 'unavailable',
      reason: 'malformed',
    });
  });

  it('не настроен (нет URL или токена) — вызова нет вовсе', async () => {
    const a = client(() => json(200, {}), { baseUrl: undefined });
    expect(await a.c.deposit('u', BODY)).toEqual({ state: 'unavailable', reason: 'not-configured' });
    expect(a.seen).toHaveLength(0);
    const b = client(() => json(200, {}), { token: '' });
    expect(await b.c.withdraw('u', BODY)).toEqual({ state: 'unavailable', reason: 'not-configured' });
    const t = client(() => json(200, {}), { tenant: undefined });
    expect(await t.c.withdraw('u', BODY)).toEqual({ state: 'unavailable', reason: 'not-configured' });
  });

  it('trading-freeze: маршрут и тело', async () => {
    const { c, seen } = client(() => json(200, {}));
    expect(await c.tradingFreeze('u', { frozen: true, reason: 'AML', operator: 'admin' })).toEqual({ state: 'ok' });
    expect(seen[0]!.url).toMatch(/\/internal\/sites\/apex-ru\/users\/u\/real\/trading-freeze$/);
    expect(JSON.parse(seen[0]!.init.body as string)).toEqual({ frozen: true, reason: 'AML', operator: 'admin' });
  });
});
