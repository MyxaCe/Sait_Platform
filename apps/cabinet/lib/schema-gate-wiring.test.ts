import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Гейт схемы кабинета ПОДКЛЮЧЁН, и подключён правильным способом.
 *
 * **Почему проверка по тексту.** Наблюдаемого следствия у отключённого
 * гейта в юнит-прогоне нет вовсе: приложение просто стартует. Увидеть
 * это можно только живым запуском против отставшей базы — а такого
 * прогона у нас нет и в CI не будет.
 *
 * **Почему вообще понадобилась.** Чиня красную основную, я **перенёс**
 * гейт из `instrumentation.ts` в отдельный модуль. Перенос — ровно то
 * место, где вызов теряется: сборка зелёная, проверки зелёные,
 * приложение стартует на любой схеме, и узнать об этом неоткуда.
 *
 * **И про способ подключения.** Он обязан стоять ВНУТРИ ветки
 * `NEXT_RUNTIME === 'nodejs'`: Next собирает `instrumentation.ts` и
 * для edge, а гейт тянет `pg` с `path` и `fs`. Вызов снаружи ветки
 * компилируется в edge-пакет и роняет production-сборку — это и
 * случилось, шесть коммитов красной основной.
 */

const CABINET = path.resolve(__dirname, '..');

function instrumentation(): string {
  return readFileSync(path.join(CABINET, 'instrumentation.ts'), 'utf8');
}

/** Код без комментариев: проза называет и модуль, и ветку. */
function code(): string {
  return instrumentation()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('гейт схемы кабинета', () => {
  it('подключён — модуль импортируется', () => {
    expect(code()).toMatch(/import\(['"]\.\/schema-gate['"]\)/);
  });

  it('и вызывается, а не только импортируется', () => {
    expect(code()).toMatch(/assertSchemaKnown\(\)/);
  });

  it('стоит ВНУТРИ ветки nodejs, а не снаружи', () => {
    const text = code();
    const branch = text.indexOf("process.env.NEXT_RUNTIME === 'nodejs'");
    const call = text.indexOf('./schema-gate');

    expect(branch, 'ветки nodejs в файле нет').toBeGreaterThan(-1);
    // Вызов до ветки означал бы, что `pg` попадёт в edge-пакет.
    expect(call).toBeGreaterThan(branch);
  });

  it('сам модуль гейта на месте и отказывает выходом', () => {
    const gate = readFileSync(path.join(CABINET, 'schema-gate.ts'), 'utf8');

    expect(gate).toContain('assertSchemaCurrent');
    // Без выхода гейт перестаёт быть гейтом: процесс продолжит отвечать.
    expect(gate).toContain('process.exit(1)');
  });

  it('`pg` не импортируется в самой инструментации', () => {
    // Статический импорт попал бы в оба пакета независимо от ветки.
    expect(code()).not.toMatch(/^import .*['"]pg['"]/m);
  });
});
