import { createHmac, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Прогрев после деплоя: `POST /api/revalidate/all` (секрет вебхука CMS).
 *
 * Главное свойство: при лежащей CMS ничего не сбрасывается — сброс не
 * дал бы новых данных, а только увёл бы страницы на последнюю версию.
 */

const revalidateTag = vi.fn();
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidateTag, revalidatePath }));
vi.mock('next/headers', () => ({ draftMode: () => ({ isEnabled: false }) }));

const SECRET = 'webhook-secret';

function signedRequest(body: object, secret = SECRET): Request {
  const raw = JSON.stringify(body);
  return new Request('http://site.test/api/revalidate/all', {
    method: 'POST',
    body: raw,
    headers: {
      'x-signature': `sha256=${createHmac('sha256', secret).update(raw, 'utf8').digest('hex')}`,
    },
  });
}

const freshBody = () => ({ event_id: randomUUID(), issued_at: new Date().toISOString() });

beforeEach(() => {
  vi.stubEnv('CMS_WEBHOOK_SECRET', SECRET);
  vi.stubEnv('CMS_API_URL', 'http://cms.test');
  vi.stubEnv('SITE_SLUG', 'apex-uk');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  revalidateTag.mockReset();
  revalidatePath.mockReset();
});

describe('POST /api/revalidate/all', () => {
  it('CMS жива → сброшены оба вида тегов каждого ресурса и кеш маршрутов', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ name: 'x' })));
    const { POST } = await import('@/app/api/revalidate/all/route');
    const { CMS_RESOURCES } = await import('./cms');

    const res = await POST(signedRequest(freshBody()));
    expect(res.status).toBe(202);
    const tags = revalidateTag.mock.calls.map((c) => c[0]);
    for (const r of CMS_RESOURCES) {
      expect(tags).toContain(`cms:${r}`);
      expect(tags).toContain(`cms:${r}:apex-uk`);
    }
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('CMS лежит → 503 и НИЧЕГО не сброшено', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('ECONNREFUSED'))));
    const { POST } = await import('@/app/api/revalidate/all/route');

    const res = await POST(signedRequest(freshBody()));
    expect(res.status).toBe(503);
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('чужая подпись → 401; старая подпись (повтор) → 400', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ name: 'x' })));
    const { POST } = await import('@/app/api/revalidate/all/route');

    expect((await POST(signedRequest(freshBody(), 'wrong'))).status).toBe(401);
    const old = { event_id: randomUUID(), issued_at: new Date(Date.now() - 3_600_000).toISOString() };
    expect((await POST(signedRequest(old))).status).toBe(400);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('секрет не задан → 503 webhook_not_configured', async () => {
    vi.stubEnv('CMS_WEBHOOK_SECRET', '');
    const { POST } = await import('@/app/api/revalidate/all/route');
    expect((await POST(signedRequest(freshBody()))).status).toBe(503);
  });
});
