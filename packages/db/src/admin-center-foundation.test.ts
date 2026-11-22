import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION = path.resolve(
  __dirname,
  '../migrations/1793449440000_admin_center_foundation.sql',
);

function sql(): string {
  return readFileSync(MIGRATION, 'utf8');
}

describe('ADM-01 · журнал неизменяем триггером базы', () => {
  it('есть функция, поднимающая exception на правку', () => {
    const text = sql();
    expect(text).toMatch(/CREATE OR REPLACE FUNCTION admin_action_journal_immutable/i);
    expect(text).toMatch(/RAISE EXCEPTION/i);
  });

  it('триггер срабатывает именно на UPDATE и DELETE, до изменения', () => {
    const text = sql();
    expect(text).toMatch(/BEFORE\s+UPDATE\s+OR\s+DELETE\s+ON\s+admin_action_journal/i);
    expect(text).toMatch(/EXECUTE FUNCTION admin_action_journal_immutable/i);
  });

  it('журнал — append-only с хеш-цепочкой, а не просто таблица', () => {
    const text = sql();
    expect(text).toMatch(/seq\s+BIGINT\s+GENERATED\s+ALWAYS\s+AS\s+IDENTITY/i);
    expect(text).toMatch(/prev_hash/i);
    expect(text).toMatch(/entry_hash\s+TEXT\s+NOT NULL/i);
  });

  it('деньги сюда не пишутся (Р-396): ни одной денежной колонки', () => {
    const text = sql();
    expect(text).not.toMatch(/balance|amount|cents|currency/i);
  });
});
