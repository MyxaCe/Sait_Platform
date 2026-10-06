/**
 * Перф-бюджет клиентского JS (скорость сайта — жёсткое требование).
 * Считает gzip-размер First Load JS каждого маршрута по
 * app-build-manifest.json.
 *
 * Запуск после `pnpm build`: node scripts/check-bundle-budget.mjs
 * Бюджет: env BUNDLE_BUDGET_BYTES (gzip, на маршрут).
 *
 * ДВА РЕЖИМА, и по умолчанию — отчёт (решение Р-031).
 *
 *   отчёт (по умолчанию)          — печатает числа, код возврата 0;
 *   гейт (BUNDLE_BUDGET_ENFORCE=1) — валит сборку при превышении.
 *
 * Почему умолчание неблокирующее. Бюджет превышен на 32 маршрутах из 35,
 * худший 215,9 КБ против 170,9, и измерено это на чистом дереве: превышение
 * накоплено, а не принесено свежими правками. Блокирующий гейт в таком
 * состоянии даёт вечно красный CI, а гейт, который невозможно удовлетворить,
 * отключают — это уже было с гейтом комплаенса.
 *
 * Отчёт обязан быть ОТЛИЧИМ от пройденной проверки: при превышении он
 * печатает «ПРЕВЫШЕНИЕ» и перечисляет каждый маршрут с перерасходом, а не
 * ограничивается восьмёркой худших. Проверка, не выполнившая своего условия,
 * не имеет права выглядеть как пройденная.
 *
 * ДОЛГ (Р-031): вернуть `BUNDLE_BUDGET_ENFORCE=1` в CI, когда превышение
 * опустится до нуля маршрутов либо бюджет будет пересмотрен осознанно.
 * Цена промедления: размер страниц растёт незаметно, и каждый месяц делает
 * возврат дороже.
 */
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

// Охват объявлен числом, а не словом «нарушений нет»: сколько маршрутов
// посчитано — это часть результата, иначе пустой отчёт неотличим от
// невыполнившегося.
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

// Числа видны в сводке прогона, а не только в логе: отчёт, за которым надо
// лезть в развёрнутый шаг, перестают открывать.
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
    // Сводка — удобство, а не результат: её отказ не должен ронять отчёт.
  }
}

if (over.length > 0 && ENFORCE) {
  console.error('\nBUDGET EXCEEDED. Trim client JS or raise the budget deliberately.');
  process.exit(1);
}
