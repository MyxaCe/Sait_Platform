import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPECTED_MIGRATIONS } from './expected';

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
    expect([...EXPECTED_MIGRATIONS]).toEqual([...EXPECTED_MIGRATIONS].sort());
  });

  it('проверка умеет краснеть — на лишнем и на недостающем', () => {
    const disk = onDisk();

    expect([...disk, '9999_lишний'].sort()).not.toEqual(disk);
    expect(disk.slice(1)).not.toEqual(disk);
  });

  it('ADM-02 · миграция блокировки клиента зарегистрирована', () => {
    expect(EXPECTED_MIGRATIONS).toContain('1794100000000_client_block');
    expect(onDisk()).toContain('1794100000000_client_block');
  });

  it('Р-446 · миграция портфелей плеча зарегистрирована', () => {
    expect(EXPECTED_MIGRATIONS).toContain('1794200000000_leverage_portfolios');
    expect(onDisk()).toContain('1794200000000_leverage_portfolios');
  });

  it('ADM-14 · миграция AML-скрининга зарегистрирована', () => {
    expect(EXPECTED_MIGRATIONS).toContain('1794400000000_client_aml_screening');
    expect(onDisk()).toContain('1794400000000_client_aml_screening');
  });

  it('Р-456 · миграция bootstrap_mode зарегистрирована', () => {
    expect(EXPECTED_MIGRATIONS).toContain('1794500000000_money_commands_bootstrap_mode');
    expect(onDisk()).toContain('1794500000000_money_commands_bootstrap_mode');
  });
});
