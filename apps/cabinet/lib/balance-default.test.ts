import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
function schema(): string {
  const dir = path.join(ROOT, 'packages/db/migrations');
  const file = readdirSync(dir).find((f) => f.endsWith('_cabinet.sql'));
  if (!file) throw new Error('миграция со схемой кабинета не найдена');
  return readFileSync(path.join(dir, file), 'utf8');
}

function balanceColumn(sql: string): string {
  return sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .find((l) => l.includes('balance_cents')) as string;
}

describe('WEB-29 · баланс не имеет умолчания', () => {
  it('колонка объявлена без DEFAULT', () => {
    expect(balanceColumn(schema())).not.toMatch(/DEFAULT/i);
  });

  it('колонка по-прежнему NOT NULL — отсутствие умолчания не ослабляет её', () => {
    expect(balanceColumn(schema())).toMatch(/NOT NULL/);
  });

  it('проверка умеет краснеть', () => {
    expect(balanceColumn('  balance_cents BIGINT NOT NULL DEFAULT 1000000,')).toMatch(/DEFAULT/i);
    expect(
      balanceColumn('  -- было DEFAULT 1000000\n  balance_cents BIGINT NOT NULL,'),
    ).not.toMatch(/DEFAULT/i);
  });
});
