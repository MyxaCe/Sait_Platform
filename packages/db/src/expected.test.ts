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

  // ADM-02 · блокировка клиента: миграция зарегистрирована и в списке кода, и
  // на диске (пара не разошлась именно по этой строке).
  it('ADM-02 · миграция блокировки клиента зарегистрирована', () => {
    expect(EXPECTED_MIGRATIONS).toContain('1794100000000_client_block');
    expect(onDisk()).toContain('1794100000000_client_block');
  });

  // WEB-44/45/46/47 · плечо-портфели: миграция в списке кода и на диске.
  it('Р-446 · миграция портфелей плеча зарегистрирована', () => {
    expect(EXPECTED_MIGRATIONS).toContain('1794200000000_leverage_portfolios');
    expect(onDisk()).toContain('1794200000000_leverage_portfolios');
  });

  // ADM-14 · ручной AML-скрининг: миграция зарегистрирована и в списке кода, и
  // на диске (пара не разошлась именно по этой строке).
  it('ADM-14 · миграция AML-скрининга зарегистрирована', () => {
    expect(EXPECTED_MIGRATIONS).toContain('1794400000000_client_aml_screening');
    expect(onDisk()).toContain('1794400000000_client_aml_screening');
  });

  // Р-456 C · bootstrap_mode вынесен отдельной миграцией (не правкой applied-миграции).
  it('Р-456 · миграция bootstrap_mode зарегистрирована', () => {
    expect(EXPECTED_MIGRATIONS).toContain('1794500000000_money_commands_bootstrap_mode');
    expect(onDisk()).toContain('1794500000000_money_commands_bootstrap_mode');
  });
});
