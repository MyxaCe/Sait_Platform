#!/usr/bin/env node
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
