#!/usr/bin/env node
/*
 * Прогрев витрины после деплоя (запускается ВНУТРИ контейнера web):
 *
 *   docker compose exec -T web node apps/web/scripts/revalidate-all.mjs
 *
 * 1. POST /api/revalidate/all с HMAC-подписью секретом вебхука CMS
 *    (`CMS_WEBHOOK_SECRET` из окружения контейнера) — сбрасывает все теги
 *    CMS и кеш маршрутов. CMS не отвечает → маршрут отвечает 503 и НИЧЕГО
 *    не сбрасывает; скрипт выходит с кодом 1.
 * 2. Обходит страницы из /sitemap.xml (ru и en), чтобы они собрались из
 *    свежих данных CMS сейчас, а не у первого посетителя. Деталки
 *    инструментов пропускаются: они динамические, кеша у них нет.
 *
 * Окружение: CMS_WEBHOOK_SECRET (обязательно), PORT (по умолчанию 3000),
 * WARM_ORIGIN (по умолчанию http://127.0.0.1:$PORT), WARM=0 — без обхода.
 */
import { createHmac, randomUUID } from 'node:crypto';

const secret = process.env.CMS_WEBHOOK_SECRET?.trim();
if (!secret) {
  console.error('[revalidate-all] CMS_WEBHOOK_SECRET не задан — нечем подписать запрос');
  process.exit(2);
}
const origin = (process.env.WARM_ORIGIN || `http://127.0.0.1:${process.env.PORT || 3000}`).replace(
  /\/$/,
  '',
);

const body = JSON.stringify({ event_id: randomUUID(), issued_at: new Date().toISOString() });
const signature = `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;

const response = await fetch(`${origin}/api/revalidate/all`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Signature': signature },
  body,
});
const result = await response.text();
console.log(`[revalidate-all] ${response.status} ${result}`);
if (response.status !== 202) process.exit(1);

if (process.env.WARM === '0') process.exit(0);

const sitemap = await fetch(`${origin}/sitemap.xml`);
if (!sitemap.ok) {
  console.error(`[revalidate-all] sitemap ${sitemap.status} — обход пропущен`);
  process.exit(1);
}
const paths = [...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g)]
  .map((m) => new URL(m[1]).pathname)
  .filter((p) => !p.startsWith('/instruments/'));
const all = [...new Set(paths.flatMap((p) => [p, p === '/' ? '/en' : `/en${p}`]))];

let failed = 0;
const queue = [...all];
async function worker() {
  for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
    try {
      const res = await fetch(`${origin}${path}`, { redirect: 'manual' });
      await res.arrayBuffer();
      if (res.status >= 500) {
        failed += 1;
        console.error(`[revalidate-all] ${res.status} ${path}`);
      }
    } catch (error) {
      failed += 1;
      console.error(`[revalidate-all] ${path}: ${error instanceof Error ? error.message : error}`);
    }
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
console.log(`[revalidate-all] прогрето страниц: ${all.length - failed}/${all.length}`);
process.exit(failed > 0 ? 1 : 0);
