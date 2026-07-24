/**
 * Перф-бюджет клиентского JS (скорость сайта — жёсткое требование).
 * Считает gzip-размер First Load JS каждого маршрута по
 * app-build-manifest.json и валит сборку при превышении бюджета.
 *
 * Запуск после `pnpm build`: node scripts/check-bundle-budget.mjs
 * Бюджет: env BUNDLE_BUDGET_BYTES (gzip, на маршрут).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET = Number(process.env.BUNDLE_BUDGET_BYTES ?? 175_000);
const nextDir = join(process.cwd(), 'apps', 'web', '.next');

const manifest = JSON.parse(readFileSync(join(nextDir, 'app-build-manifest.json'), 'utf8'));

const gzipCache = new Map();
function gzipSize(file) {
  if (!gzipCache.has(file)) {
    gzipCache.set(file, gzipSync(readFileSync(join(nextDir, file))).length);
  }
  return gzipCache.get(file);
}

const routes = Object.entries(manifest.pages)
  .map(([route, files]) => {
    const js = [...new Set(files.filter((f) => f.endsWith('.js')))];
    const bytes = js.reduce((sum, f) => sum + gzipSize(f), 0);
    return { route, bytes };
  })
  .sort((a, b) => b.bytes - a.bytes);

const kb = (b) => `${(b / 1024).toFixed(1)} KB`;
console.log(`bundle budget: ${kb(BUDGET)} gzip per route\n`);
for (const { route, bytes } of routes.slice(0, 8)) {
  console.log(`${bytes > BUDGET ? '✗' : '✓'} ${kb(bytes).padStart(9)}  ${route}`);
}

const over = routes.filter((r) => r.bytes > BUDGET);
if (over.length > 0) {
  console.error(`\nBUDGET EXCEEDED on ${over.length} route(s). Trim client JS or raise the budget deliberately.`);
  process.exit(1);
}
console.log(`\nall ${routes.length} routes within budget (max: ${kb(routes[0]?.bytes ?? 0)})`);
