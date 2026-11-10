import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { cmsFetch, CmsError } from './server';

/**
 * Тесты слоёв изоляции cmsFetch (риск R-06).
 *
 * С 10.11 подмены фикстурами нет: CMS лежит / отвечает мусором / 5xx →
 * `CmsError` наружу. Что показать вместо — последний удачный ответ CMS
 * или честную заглушку — решает потребитель (`apps/web/lib/cms.ts`).
 */

const schema = z.object({ name: z.string() });

beforeEach(() => {
  vi.stubEnv('CMS_API_URL', 'http://cms.test');
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

describe('cmsFetch — отказ CMS бросает, а не подменяет', () => {
  it('connection refused → CmsError', async () => {
    stubFetch(() => Promise.reject(new Error('ECONNREFUSED')));
    await expect(cmsFetch('/cms/brand', { schema })).rejects.toBeInstanceOf(CmsError);
  });

  it('500 → CmsError с кодом в сообщении', async () => {
    stubFetch(() => Promise.resolve(new Response('oops', { status: 500 })));
    await expect(cmsFetch('/cms/brand', { schema })).rejects.toThrow(/HTTP 500/);
  });

  it('ответ мимо схемы → CmsError (мусор не доходит до страниц)', async () => {
    stubFetch(() => Promise.resolve(Response.json({ unexpected: true })));
    await expect(cmsFetch('/cms/brand', { schema })).rejects.toThrow(/schema/);
  });

  it('CMS_API_URL не задан → CmsError, в сеть не ходим', async () => {
    vi.stubEnv('CMS_API_URL', '');
    const mock = stubFetch(() => Promise.resolve(Response.json({ name: 'x' })));
    await expect(cmsFetch('/cms/brand', { schema })).rejects.toBeInstanceOf(CmsError);
    expect(mock).not.toHaveBeenCalled();
  });

  it('валидный ответ → данные; передаются locale, X-API-Key и теги', async () => {
    vi.stubEnv('CMS_API_KEY', 'k-123');
    const mock = stubFetch(() => Promise.resolve(Response.json({ name: 'live' })));
    const result = await cmsFetch('/cms/brand', { schema, locale: 'en', tags: ['cms:brand'] });
    expect(result).toEqual({ name: 'live' });
    const calls = mock.mock.calls as unknown as [string, RequestInit & { next?: unknown }][];
    const [url, init] = calls[0]!;
    expect(String(url)).toContain('locale=en');
    expect(init.headers).toMatchObject({ 'X-API-Key': 'k-123' });
    expect(init.next).toMatchObject({ tags: ['cms:brand'] });
  });
});
