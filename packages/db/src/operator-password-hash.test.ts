import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION = path.resolve(
  __dirname,
  '../migrations/1793535840000_operator_password_hash.sql',
);

function sql(): string {
  return readFileSync(MIGRATION, 'utf8');
}

describe('ADM-01 · миграция пароля оператора', () => {
  it('добавляет колонку password_hash в operators через ALTER', () => {
    const text = sql();
    expect(text).toMatch(/ALTER TABLE\s+operators\s+ADD COLUMN/i);
    expect(text).toMatch(/password_hash\s+TEXT/i);
  });

  it('колонка nullable: нет NOT NULL и нет DEFAULT у password_hash', () => {
    const text = sql();
    const addLine = text
      .split('\n')
      .find((l) => /ADD COLUMN/i.test(l) && /password_hash/i.test(l));
    expect(addLine, 'строка ADD COLUMN password_hash').toBeTruthy();
    expect(addLine!).not.toMatch(/NOT NULL/i);
    expect(addLine!).not.toMatch(/DEFAULT/i);
  });

  it('никакой денежной колонки сюда не заводится (Р-396)', () => {
    expect(sql()).not.toMatch(/balance|amount|cents|currency/i);
  });
});
