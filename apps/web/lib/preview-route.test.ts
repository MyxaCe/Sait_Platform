import { afterEach, describe, expect, it, vi } from 'vitest';

const draft = vi.hoisted(() => ({ enabled: false, enable: vi.fn(), disable: vi.fn() }));
vi.mock('next/headers', () => ({
  draftMode: () => ({
    get isEnabled() {
      return draft.enabled;
    },
    enable: () => {
      draft.enabled = true;
      draft.enable();
    },
    disable: () => {
      draft.enabled = false;
      draft.disable();
    },
  }),
}));

const { GET } = await import('../app/api/preview/route');
const { GET: DISABLE } = await import('../app/api/preview/disable/route');

const request = (query: string) => new Request(`http://site.test/api/preview?${query}`, { headers: { host: 'site.test' } });

afterEach(() => {
  vi.unstubAllEnvs();
  draft.enabled = false;
  draft.enable.mockClear();
  draft.disable.mockClear();
});

describe('предпросмотр статьи из админки (draft mode по секрету)', () => {
  it('секрет не задан в окружении — 503, режим не включается', async () => {
    vi.stubEnv('PREVIEW_SECRET', '');
    const res = await GET(request('secret=x&path=/analytics/news/gold'));
    expect(res.status).toBe(503);
    expect(draft.enable).not.toHaveBeenCalled();
  });

  it('неверный секрет — 401', async () => {
    vi.stubEnv('PREVIEW_SECRET', 'test-preview-secret');
    const res = await GET(request('secret=wrong&path=/analytics/news/gold'));
    expect(res.status).toBe(401);
    expect(draft.enable).not.toHaveBeenCalled();
  });

  it('верный секрет — включает draft mode и ведёт на страницу статьи (с префиксом языка)', async () => {
    vi.stubEnv('PREVIEW_SECRET', 'test-preview-secret');
    const res = await GET(request(`secret=test-preview-secret&path=${encodeURIComponent('/de/education/articles/what-is-forex')}`));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://site.test/de/education/articles/what-is-forex');
    expect(draft.enable).toHaveBeenCalledOnce();
  });

  it('внешний адрес в path не уводит с сайта', async () => {
    vi.stubEnv('PREVIEW_SECRET', 'test-preview-secret');
    const res = await GET(request('secret=test-preview-secret&path=https://evil.example'));
    expect(res.headers.get('location')).toBe('http://site.test/');
  });

  it('выход из предпросмотра выключает draft mode', async () => {
    draft.enabled = true;
    const res = await DISABLE(new Request('http://site.test/api/preview/disable?path=/analytics/news', { headers: { host: 'site.test' } }));
    expect(draft.disable).toHaveBeenCalledOnce();
    expect(res.headers.get('location')).toBe('http://site.test/analytics/news');
  });
});
