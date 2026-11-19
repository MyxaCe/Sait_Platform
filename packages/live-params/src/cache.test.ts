import { describe, expect, it, vi } from 'vitest';
import { createCachedLoader, MAX_TTL_MS } from './cache';

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('кэш настроек', () => {
  it('удачное чтение живёт не дольше 60 с', async () => {
    const c = clock();
    let n = 0;
    const load = vi.fn(async () => ++n);
    const get = createCachedLoader(load, { ttlMs: 10 * 60_000, now: c.now });
    expect(await get()).toBe(1);
    c.advance(MAX_TTL_MS - 1);
    expect(await get()).toBe(1);
    c.advance(1);
    expect(await get()).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('после сбоя — null, а не прежнее значение', async () => {
    const c = clock();
    const onError = vi.fn();
    let fail = false;
    const get = createCachedLoader(
      async () => {
        if (fail) throw new Error('db down');
        return 'ok';
      },
      { now: c.now, onError },
    );
    expect(await get()).toBe('ok');
    fail = true;
    c.advance(MAX_TTL_MS);
    expect(await get()).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('сбой кэшируется коротко и не долбит базу', async () => {
    const c = clock();
    const load = vi.fn(async () => {
      throw new Error('db down');
    });
    const get = createCachedLoader(load, { now: c.now, failureTtlMs: 5_000, onError: () => {} });
    await get();
    await get();
    expect(load).toHaveBeenCalledTimes(1);
    c.advance(5_000);
    await get();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('параллельные запросы — одно чтение', async () => {
    const load = vi.fn(async () => 'x');
    const get = createCachedLoader(load);
    await Promise.all([get(), get(), get()]);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
