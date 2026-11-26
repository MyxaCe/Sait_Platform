import { describe, expect, it, vi } from 'vitest';
import { proxyCmsMedia } from './media-proxy';

const CMS = 'http://broker-cms:3001/v1';

function upstream(body: BodyInit | null, init: ResponseInit) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(body, init));
}

function request(method = 'GET', headers: Record<string, string> = {}) {
  return new Request('https://site.example.test/media/logo.png', { method, headers });
}

describe('proxyCmsMedia', () => {
  it('ходит во внутренний адрес CMS и пробрасывает тип, длину, ETag и Last-Modified', async () => {
    const fetchImpl = upstream('PNGDATA', {
      status: 200,
      headers: { 'Content-Type': 'image/png', 'Content-Length': '7', ETag: '"abc"', 'Last-Modified': 'Wed, 25 Nov 2026 10:00:00 GMT' },
    });
    const res = await proxyCmsMedia(request(), ['logo.png'], { cmsApiUrl: CMS, fetchImpl });
    expect(fetchImpl.mock.calls[0]![0]).toBe('http://broker-cms:3001/api/media/file/logo.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-length')).toBe('7');
    expect(res.headers.get('etag')).toBe('"abc"');
    expect(res.headers.get('last-modified')).toBe('Wed, 25 Nov 2026 10:00:00 GMT');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toContain('public');
    expect(await res.text()).toBe('PNGDATA');
  });

  it('условный запрос пробрасывается, 304 возвращается без тела', async () => {
    const fetchImpl = upstream(null, { status: 304, headers: { ETag: '"abc"' } });
    const res = await proxyCmsMedia(request('GET', { 'If-None-Match': '"abc"' }), ['logo.png'], { cmsApiUrl: CMS, fetchImpl });
    const sent = new Headers(fetchImpl.mock.calls[0]![1]!.headers);
    expect(sent.get('if-none-match')).toBe('"abc"');
    expect(res.status).toBe(304);
    expect(res.headers.get('etag')).toBe('"abc"');
  });

  it('HEAD: заголовки без тела, к CMS идёт GET (Payload не отвечает на HEAD)', async () => {
    const fetchImpl = upstream('PNGDATA', { status: 200, headers: { 'Content-Type': 'image/png', 'Content-Length': '7' } });
    const res = await proxyCmsMedia(request('HEAD'), ['logo.png'], { cmsApiUrl: CMS, fetchImpl });
    expect(fetchImpl.mock.calls[0]![1]!.method).toBe('GET');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe('7');
    expect(await res.text()).toBe('');
  });

  it('другие методы — 405, без запроса в CMS', async () => {
    const fetchImpl = upstream('x', { status: 200 });
    const res = await proxyCmsMedia(request('POST'), ['logo.png'], { cmsApiUrl: CMS, fetchImpl });
    expect(res.status).toBe(405);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('недопустимые пути — 404, без запроса в CMS', async () => {
    const fetchImpl = upstream('x', { status: 200 });
    for (const segments of [[], ['a', 'b.png'], ['..'], ['..%2F..%2Fetc'], ['.env'], ['a%00.png']]) {
      const res = await proxyCmsMedia(request(), segments, { cmsApiUrl: CMS, fetchImpl });
      expect(res.status).toBe(404);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('404 CMS — 404; ошибки CMS и сеть — 502', async () => {
    expect((await proxyCmsMedia(request(), ['x.png'], { cmsApiUrl: CMS, fetchImpl: upstream('{}', { status: 404 }) })).status).toBe(404);
    expect((await proxyCmsMedia(request(), ['x.png'], { cmsApiUrl: CMS, fetchImpl: upstream('{}', { status: 500 }) })).status).toBe(502);
    const broken = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    expect((await proxyCmsMedia(request(), ['x.png'], { cmsApiUrl: CMS, fetchImpl: broken })).status).toBe(502);
  });

  it('не картинки и не PDF не отдаёт', async () => {
    const fetchImpl = upstream('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    expect((await proxyCmsMedia(request(), ['x.html'], { cmsApiUrl: CMS, fetchImpl })).status).toBe(404);
  });

  it('SVG и PDF — с CSP sandbox', async () => {
    for (const type of ['image/svg+xml', 'application/pdf']) {
      const res = await proxyCmsMedia(request(), ['x'], { cmsApiUrl: CMS, fetchImpl: upstream('<svg/>', { status: 200, headers: { 'Content-Type': type } }) });
      expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
      expect(res.headers.get('content-security-policy')).toContain('sandbox');
    }
  });

  it('слишком большой файл — 502 по Content-Length, поток без длины обрывается', async () => {
    const big = await proxyCmsMedia(request(), ['x.png'], {
      cmsApiUrl: CMS,
      maxBytes: 4,
      fetchImpl: upstream('12345', { status: 200, headers: { 'Content-Type': 'image/png', 'Content-Length': '5' } }),
    });
    expect(big.status).toBe(502);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(3));
        c.enqueue(new Uint8Array(3));
        c.close();
      },
    });
    const res = await proxyCmsMedia(request(), ['x.png'], {
      cmsApiUrl: CMS,
      maxBytes: 4,
      fetchImpl: upstream(stream, { status: 200, headers: { 'Content-Type': 'image/png' } }),
    });
    await expect(res.arrayBuffer()).rejects.toThrow();
  });

  it('без CMS_API_URL — 503', async () => {
    const res = await proxyCmsMedia(request(), ['x.png'], { cmsApiUrl: '', fetchImpl: upstream('x', { status: 200 }) });
    expect(res.status).toBe(503);
  });
});
