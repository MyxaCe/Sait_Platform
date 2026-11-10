import { revalidatePath, revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { readTenantSlug } from '@broker/tenant';
import { CMS_RESOURCES, cmsTags } from '@/lib/cms';
import { isDuplicateEvent, verifySignature } from '@/lib/revalidate';

/**
 * Прогрев после деплоя: пересобрать ВСЕ теги CMS и кеш маршрутов.
 *
 * Защита — тот же секрет вебхука CMS (`CMS_WEBHOOK_SECRET`) и та же
 * HMAC-подпись `X-Signature: sha256=<hex>`, что у `POST /api/revalidate`.
 * Тело: `{"event_id": "<uuid>", "issued_at": "<ISO>"}`; подпись старше
 * 5 минут не принимается (повтор перехваченного запроса бесполезен).
 *
 * **CMS проверяется ДО инвалидации.** Сброс тегов при лежащей CMS не дал
 * бы новых данных, а data-cache Next считает сброшенную запись
 * отсутствующей — страницы ушли бы на последнюю сохранённую версию
 * (`lib/cms-last-good.ts`) без всякой пользы. Поэтому CMS не отвечает →
 * 503 и ничего не сбрасываем.
 *
 * Запускается скриптом `scripts/revalidate-all.mjs` изнутри контейнера
 * (см. `deploy/vps/README.md`, «Кэш витрины и прогрев»).
 */

export const dynamic = 'force-dynamic';

const MAX_AGE_MS = 5 * 60_000;

const bodySchema = z.object({
  event_id: z.string().uuid(),
  issued_at: z.string().datetime(),
});

async function cmsReachable(slug: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const base = process.env.CMS_API_URL?.trim().replace(/\/$/, '');
  if (!base) return { ok: false, reason: 'CMS_API_URL не задан' };
  try {
    const response = await fetch(
      `${base}/cms/brand?site=${encodeURIComponent(slug)}&locale=ru`,
      {
        headers: process.env.CMS_API_KEY ? { 'X-API-Key': process.env.CMS_API_KEY } : {},
        cache: 'no-store',
        signal: AbortSignal.timeout(5_000),
      },
    );
    return response.ok ? { ok: true } : { ok: false, reason: `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function POST(request: Request) {
  const secret = process.env.CMS_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'webhook_not_configured' }, { status: 503 });
  }

  const raw = await request.text();
  if (!verifySignature(raw, request.headers.get('x-signature'), secret)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(JSON.parse(raw));
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const age = Date.now() - Date.parse(parsed.issued_at);
  if (!(age >= -60_000 && age <= MAX_AGE_MS)) {
    return NextResponse.json({ error: 'stale_request' }, { status: 400 });
  }
  if (isDuplicateEvent(parsed.event_id)) {
    return NextResponse.json({ deduplicated: true }, { status: 202 });
  }

  const slug = readTenantSlug(process.env.SITE_SLUG);
  if (slug === null) {
    return NextResponse.json({ error: 'site_slug_not_configured' }, { status: 503 });
  }

  const cms = await cmsReachable(slug);
  if (!cms.ok) {
    console.error(`[revalidate-all] CMS не отвечает (${cms.reason}) — кеш НЕ сброшен`);
    return NextResponse.json({ error: 'cms_unreachable', reason: cms.reason }, { status: 503 });
  }

  const tags = CMS_RESOURCES.flatMap((resource) => cmsTags(resource, slug));
  for (const tag of tags) revalidateTag(tag);
  // Кеш маршрутов целиком: страницы пересоберутся при следующем запросе
  revalidatePath('/', 'layout');

  console.info(`[revalidate-all] event=${parsed.event_id} tags=${tags.length} + все маршруты`);
  return NextResponse.json({ applied: tags, paths: ['/ (layout)'] }, { status: 202 });
}
