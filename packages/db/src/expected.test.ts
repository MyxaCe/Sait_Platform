import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPECTED_MIGRATIONS } from './expected';

/**
 * WEB-31 · список, который знает приложение, и каталог, который
 * применяет механизм, — не разошлись.
 *
 * Это два перечисления одного, и расходятся такие пары молча. Здесь
 * расхождение означало бы худшее из возможного: приложение проверяет
 * не то, что применяется, то есть проверка схемы начинает врать —
 * а ей верят больше, чем себе.
 */

const DIR = path.resolve(__dirname, '../migrations');

function onDisk(): string[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => f.slice(0, -4))
    .sort();
}

describe('WEB-31 · список и каталог', () => {
  it('скан дошёл до файлов, а не зелен из-за пустого каталога', () => {
    expect(onDisk().length).toBeGreaterThan(0);
  });

  it('совпадают имя в имя', () => {
    expect([...EXPECTED_MIGRATIONS].sort()).toEqual(onDisk());
  });

  it('порядок задан именами и не зависит от порядка чтения каталога', () => {
    // Применение идёт по имени: файл, выпавший из порядка, применился
    // бы не там, где задуман.
    expect([...EXPECTED_MIGRATIONS]).toEqual([...EXPECTED_MIGRATIONS].sort());
  });

  it('проверка умеет краснеть — на лишнем и на недостающем', () => {
    const disk = onDisk();

    expect([...disk, '9999_lишний'].sort()).not.toEqual(disk);
    expect(disk.slice(1)).not.toEqual(disk);
  });
});
