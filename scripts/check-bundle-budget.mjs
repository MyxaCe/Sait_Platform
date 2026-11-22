import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET = Number(process.env.BUNDLE_BUDGET_BYTES ?? 175_000);
const ENFORCE = process.env.BUNDLE_BUDGET_ENFORCE === '1';
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
const over = routes.filter((r) => r.bytes > BUDGET);

console.log(`bundle budget: ${kb(BUDGET)} gzip per route`);
console.log(`routes measured: ${routes.length}   over budget: ${over.length}`);
console.log(`mode: ${ENFORCE ? 'ГЕЙТ (превышение валит сборку)' : 'ОТЧЁТ (не блокирует, Р-031)'}\n`);

for (const { route, bytes } of routes) {
  const mark = bytes > BUDGET ? '✗' : '✓';
  const delta = bytes > BUDGET ? `  (+${kb(bytes - BUDGET)})` : '';
  console.log(`${mark} ${kb(bytes).padStart(9)}  ${route}${delta}`);
}

const worst = routes[0];
const summary =
  over.length === 0
    ? `все ${routes.length} маршрутов в бюджете ${kb(BUDGET)} (максимум ${kb(worst?.bytes ?? 0)})`
    : `ПРЕВЫШЕНИЕ бюджета ${kb(BUDGET)} на ${over.length} маршрутах из ${routes.length}; ` +
      `худший ${worst.route} — ${kb(worst.bytes)} (+${kb(worst.bytes - BUDGET)})`;

console.log(`\n${summary}`);

if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    `### Bundle size ${over.length === 0 ? '✅' : '⚠️'}`,
    '',
    summary,
    '',
    '| | gzip | маршрут |',
    '| --- | ---: | --- |',
    ...routes.slice(0, 10).map(
      ({ route, bytes }) => `| ${bytes > BUDGET ? '✗' : '✓'} | ${kb(bytes)} | \`${route}\` |`,
    ),
    '',
  ];
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
  } catch {
  }
}

if (over.length > 0 && ENFORCE) {
  console.error('\nBUDGET EXCEEDED. Trim client JS or raise the budget deliberately.');
  process.exit(1);
}
