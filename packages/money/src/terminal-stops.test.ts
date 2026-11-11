import { describe, expect, it } from 'vitest';
import { createTerminalStopsClient } from './terminal-stops';

/**
 * Контракт маршрута «минимальная дистанция SL/TP»: метод, путь, заголовок,
 * тело — ровно как договорено с терминалом; исходы ok / refused / unavailable.
 */

function client(respond: (req: { url: string; init: RequestInit }) => Response | Promise<Response>) {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return respond({ url, init });
  }) as unknown as typeof fetch;
  const c = createTerminalStopsClient({ baseUrl: 'http://term:8080/', token: 'tok', tenant: 'demo-site', fetchImpl });
  return { c, seen };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('terminal-stops', () => {
  it('PUT /internal/sites/{tenant}/settings/stops, X-Internal-Token, тело { min_stop_bps }', async () => {
    const { c, seen } = client(() => json(200, { min_stop_bps: 10 }));
    expect(await c.setMinStop(10)).toEqual({ state: 'ok', minStopBps: 10 });
    expect(seen[0]!.url).toBe('http://term:8080/internal/sites/demo-site/settings/stops');
    expect(seen[0]!.init.method).toBe('PUT');
    expect((seen[0]!.init.headers as Record<string, string>)['x-internal-token']).toBe('tok');
    expect(JSON.parse(String(seen[0]!.init.body))).toEqual({ min_stop_bps: 10 });
  });

  it('GET того же пути → текущее значение', async () => {
    const { c, seen } = client(() => json(200, { min_stop_bps: 25 }));
    expect(await c.getMinStop()).toEqual({ state: 'ok', minStopBps: 25 });
    expect(seen[0]!.init.method).toBe('GET');
    expect(seen[0]!.init.body).toBeUndefined();
  });

  it('значение вне 0..10000 или нецелое — терминал не вызывается', async () => {
    const { c, seen } = client(() => json(200, { min_stop_bps: 0 }));
    for (const bad of [-1, 10_001, 1.5, Number.NaN]) {
      expect((await c.setMinStop(bad)).state).toBe('refused');
    }
    expect(seen).toHaveLength(0);
  });

  it('недоступность: сеть, 5xx, мусор, токен, 404 без кода; отказ — 4xx с кодом', async () => {
    const net = client(() => {
      throw new Error('ECONNREFUSED');
    });
    expect(await net.c.setMinStop(10)).toEqual({ state: 'unavailable', reason: 'network' });
    expect(await client(() => json(503, { error: 'x' })).c.setMinStop(10)).toEqual({ state: 'unavailable', reason: 'http-error' });
    expect(await client(() => json(200, { nope: 1 })).c.setMinStop(10)).toEqual({ state: 'unavailable', reason: 'malformed' });
    expect(await client(() => json(401, { error: 'invalid_internal_token' })).c.getMinStop()).toEqual({ state: 'unavailable', reason: 'auth' });
    // Контракт терминала: 401 без заголовка, 403 неверный токен, 404 токен не задан.
    for (const status of [401, 403, 404]) {
      expect(await client(() => new Response('', { status })).c.setMinStop(10)).toEqual({ state: 'unavailable', reason: 'auth' });
    }
    expect(await client(() => new Response('', { status: 400 })).c.setMinStop(10)).toEqual({
      state: 'refused',
      code: 'invalid_min_stop_bps',
      status: 400,
    });
    expect(await client(() => json(400, { error: 'invalid_min_stop_bps' })).c.setMinStop(10)).toEqual({
      state: 'refused',
      code: 'invalid_min_stop_bps',
      status: 400,
    });
    const none = createTerminalStopsClient({ baseUrl: undefined, token: 'tok', tenant: 'x' });
    expect(await none.getMinStop()).toEqual({ state: 'unavailable', reason: 'not-configured' });
  });
});
