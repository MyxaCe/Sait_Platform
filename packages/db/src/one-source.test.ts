import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * WEB-31 · у схемы ОДИН источник.
 *
 * `db/init` монтируется в `docker-entrypoint-initdb.d` и выполняется
 * при создании базы. Оставить там `.sql` и завести миграции значило бы
 * получить два источника: на свежей базе схема накатилась бы дважды, а
 * расходиться они начали бы молча — и первым это заметил бы прод.
 *
 * Вернуть файл туда легко и выглядит безобидно, поэтому запрет
 * проверяется, а не подразумевается.
 */

const ROOT = path.resolve(__dirname, '../../..');

describe('WEB-31 · схема не живёт в двух местах', () => {
  it('в `db/init` нет ни одного исполняемого файла схемы', () => {
    const dir = path.join(ROOT, 'db', 'init');
    if (!existsSync(dir)) return;

    // Postgres исполняет оттуда именно эти расширения.
    const executable = readdirSync(dir).filter(
      (f) => f.endsWith('.sql') || f.endsWith('.sql.gz') || f.endsWith('.sh'),
    );

    expect(executable).toEqual([]);
  });

  it('объяснение на месте — тот, кто придёт искать схему, найдёт указание', () => {
    expect(existsSync(path.join(ROOT, 'db', 'init', 'README.md'))).toBe(true);
  });

  it('миграции на месте и не пусты', () => {
    const migrations = readdirSync(path.resolve(__dirname, '../migrations'));

    expect(migrations.filter((f) => f.endsWith('.sql')).length).toBeGreaterThan(0);
  });
});
