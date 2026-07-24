import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { cmsFetch, CmsError } from './server';

/**
 * Тесты слоёв изоляции cmsFetch (риск R-06, чеклист §9.3 брифа):
 * CMS лежит / отвечает мусором / отвечает 5xx → сайт живёт на фолбэке.
 */

const schema = z.object({ name: z.string() });
const FALLBACK = { name: 'fallback' };

beforeEach(() => {
  vi.stubEnv('CMS_API_URL', 'http://cms.test');
  vi.spyOn(console, 'error').mockImplementation(() => {});
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

describe('cmsFetch — изоляция при недоступной CMS', () => {
  it('CMS недоступна (connection refused) → фолбэк + алерт в лог', async () => {
    stubFetch(() => Promise.reject(new Error('ECONNREFUSED')));
    const result = await cmsFetch('/cms/brand', { schema, fallback: FALLBACK });
    expect(result).toEqual(FALLBACK);
    expect(console.error).toHaveBeenCalled();
  });

  it('CMS отвечает 500 → фолбэк', async () => {
    stubFetch(() => Promise.resolve(new Response('oops', { status: 500 })));
    expect(await cmsFetch('/cms/brand', { schema, fallback: FALLBACK })).toEqual(FALLBACK);
  });

  it('CMS отвечает невалидным по схеме JSON → фолбэк (мусор не доходит до страниц)', async () => {
    stubFetch(() =>
      Promise.resolve(Response.json({ unexpected: true })),
    );
    expect(await cmsFetch('/cms/brand', { schema, fallback: FALLBACK })).toEqual(FALLBACK);
  });

  it('валидный ответ → распарсенные данные; передаются locale и X-API-Key', async () => {
    vi.stubEnv('CMS_API_KEY', 'k-123');
    const mock = stubFetch(() => Promise.resolve(Response.json({ name: 'live' })));
    const result = await cmsFetch('/cms/brand', { schema, locale: 'en', fallback: FALLBACK });
    expect(result).toEqual({ name: 'live' });
    const calls = mock.mock.calls as unknown as [string, RequestInit][];
    const [url, init] = calls[0]!;
    expect(String(url)).toContain('locale=en');
    expect(init.headers).toMatchObject({ 'X-API-Key': 'k-123' });
  });

  it('без фолбэка ошибка не глотается — CmsError наружу', async () => {
    stubFetch(() => Promise.reject(new Error('down')));
    await expect(cmsFetch('/cms/brand', { schema })).rejects.toBeInstanceOf(CmsError);
  });
});
