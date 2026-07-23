/**
 * Генерация JSON Schema из Zod-контракта — артефакт для команды CRM
 * (их CI валидирует ответы ручек этими схемами; см. спецификацию §9).
 * Запуск: pnpm --filter @broker/api-client gen:json-schema
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { CMS_RESPONSE_SCHEMAS, LEAD_SCHEMAS } from '../src/schemas';

const outDir = join(import.meta.dirname, '..', 'artifacts', 'json-schema');
mkdirSync(outDir, { recursive: true });

let count = 0;

for (const [name, schema] of Object.entries(CMS_RESPONSE_SCHEMAS)) {
  const json = zodToJsonSchema(schema, { name: `cms.${name}`, target: 'jsonSchema7' });
  writeFileSync(join(outDir, `cms.${name}.schema.json`), JSON.stringify(json, null, 2));
  count++;
}

for (const [name, schema] of Object.entries(LEAD_SCHEMAS)) {
  const json = zodToJsonSchema(schema, { name: `leads.${name}`, target: 'jsonSchema7' });
  writeFileSync(join(outDir, `leads.${name}.schema.json`), JSON.stringify(json, null, 2));
  count++;
}

console.log(`generated ${count} JSON Schema files → ${outDir}`);
