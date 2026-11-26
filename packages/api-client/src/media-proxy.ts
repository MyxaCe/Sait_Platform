// Прокси медиа CMS для /media/<файл> витрины и кабинета. Только сервер.
//
// Решения:
// - Ходим во внутренний адрес CMS (origin из CMS_API_URL, например http://broker-cms:3001),
//   путь Payload /api/media/file/<имя>. Публичный cms.<домен> закрыт по IP и не нужен.
// - Только GET/HEAD, одно имя файла без подкаталогов и без параметров запроса.
// - Отдаём только картинки и PDF (документы лицензий). SVG разрешён: в <img> скрипты не выполняются,
//   а при прямом открытии файла действует CSP `default-src 'none'; style-src 'unsafe-inline'; sandbox`
//   и nosniff — встроенный скрипт не выполнится. PDF — тот же CSP sandbox.
// - ETag/Last-Modified пробрасываем, условные запросы → 304. Имена файлов Payload не содержат хеша
//   содержимого, поэтому не immutable: час в кеше + перепроверка по ETag.
// - Тайм-аут 10 с, лимит 15 МБ: больше — 502, поток обрывается.

import { safeMediaName } from './media';

const ALLOWED_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'application/pdf',
]);

export const MEDIA_MAX_BYTES = 15 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const CACHE_CONTROL = 'public, max-age=3600, stale-while-revalidate=86400';
const SANDBOX_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

export interface MediaProxyOptions {
  /** Внутренний адрес API CMS (CMS_API_URL), например http://broker-cms:3001/v1. */
  cmsApiUrl?: string | null;
  fetchImpl?: typeof fetch;
  maxBytes?: number;
}

function cmsOrigin(cmsApiUrl: string | null | undefined): string | null {
  if (!cmsApiUrl) return null;
  try {
    return new URL(cmsApiUrl).origin;
  } catch {
    return null;
  }
}

function notFound(): Response {
  return new Response('Not found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
  });
}

function limited(body: ReadableStream<Uint8Array>, maxBytes: number): ReadableStream<Uint8Array> {
  let seen = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > maxBytes) {
          controller.error(new Error('media too large'));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
}

/** Обработка GET/HEAD /media/<segments…>. `segments` — сегменты пути после /media/. */
export async function proxyCmsMedia(
  request: Request,
  segments: readonly string[],
  options: MediaProxyOptions = {},
): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  if (segments.length !== 1) return notFound();
  const name = safeMediaName(segments[0]!);
  if (name === null) return notFound();

  const origin = cmsOrigin(options.cmsApiUrl ?? process.env.CMS_API_URL);
  if (!origin) {
    return new Response('Media unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  const forward = new Headers();
  for (const header of ['if-none-match', 'if-modified-since']) {
    const value = request.headers.get(header);
    if (value) forward.set(header, value);
  }

  let upstream: Response;
  try {
    upstream = await (options.fetchImpl ?? fetch)(`${origin}/api/media/file/${encodeURIComponent(name)}`, {
      // Payload не отвечает на HEAD у файлов (404) — всегда GET, для HEAD тело отбрасываем.
      method: 'GET',
      headers: forward,
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return new Response('Bad gateway', { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }

  const passthrough = new Headers({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': CACHE_CONTROL });
  for (const header of ['etag', 'last-modified']) {
    const value = upstream.headers.get(header);
    if (value) passthrough.set(header, value);
  }

  if (upstream.status === 304) return new Response(null, { status: 304, headers: passthrough });
  if (upstream.status === 404 || upstream.status === 403) return notFound();
  if (!upstream.ok) return new Response('Bad gateway', { status: 502, headers: { 'Cache-Control': 'no-store' } });

  const type = (upstream.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (!ALLOWED_TYPES.has(type)) return notFound();

  const maxBytes = options.maxBytes ?? MEDIA_MAX_BYTES;
  const length = Number(upstream.headers.get('content-length') ?? NaN);
  if (Number.isFinite(length) && length > maxBytes) {
    return new Response('Media too large', { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }

  passthrough.set('Content-Type', type);
  if (Number.isFinite(length)) passthrough.set('Content-Length', String(length));
  if (type === 'image/svg+xml' || type === 'application/pdf') {
    passthrough.set('Content-Security-Policy', SANDBOX_CSP);
    passthrough.set('Content-Disposition', 'inline');
  }

  if (method === 'HEAD' || !upstream.body) {
    await upstream.body?.cancel().catch(() => undefined);
    return new Response(null, { status: 200, headers: passthrough });
  }
  return new Response(limited(upstream.body, maxBytes), { status: 200, headers: passthrough });
}
