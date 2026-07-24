/**
 * Экспорт эталонных фикстур CMS-контракта из живого mock-CMS:
 * все ресурсы × локали → packages/api-client/artifacts/fixtures/.
 * Назначение: seed для CMS-сервиса + контрактные тесты обеих сторон
 * (кладутся в platform-contracts вместе с JSON Schema).
 *
 * Требует запущенный сайт: node scripts/export-cms-fixtures.mjs [--base URL]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const base = (args.includes('--base') ? args[args.indexOf('--base') + 1] : null) ?? 'http://localhost:3000';

const RESOURCES = [
  'brand',
  'navigation',
  'instruments',
  'accounts',
  'faq',
  'promotions',
  'partners',
  'academy',
  'streams',
  'articles',
  'contacts',
  'careers',
  'legal',
  'system-status',
];
const LOCALES = ['ru', 'en'];

const outDir = join(process.cwd(), 'packages', 'api-client', 'artifacts', 'fixtures');
mkdirSync(outDir, { recursive: true });

let count = 0;
for (const resource of RESOURCES) {
  for (const locale of LOCALES) {
    const res = await fetch(`${base}/api/cms/${resource}?locale=${locale}`);
    if (!res.ok) {
      console.error(`FAIL ${resource} (${locale}): HTTP ${res.status}`);
      process.exit(1);
    }
    const data = await res.json();
    writeFileSync(
      join(outDir, `cms.${resource}.${locale}.json`),
      JSON.stringify(data, null, 2),
    );
    count++;
  }
}

console.log(`exported ${count} fixtures -> ${outDir}`);
