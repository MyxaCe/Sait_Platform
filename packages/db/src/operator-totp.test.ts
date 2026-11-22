import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION = path.resolve(__dirname, '../migrations/1793881440000_operator_totp.sql');

function sql(): string {
  return readFileSync(MIGRATION, 'utf8');
}

describe('ADM-13 · миграция TOTP оператора', () => {
  it('добавляет totp_secret и totp_enrolled_at в operators через ALTER', () => {
    const text = sql();
    expect(text).toMatch(/ALTER TABLE\s+operators\s+ADD COLUMN[\s\S]*totp_secret\s+TEXT/i);
    expect(text).toMatch(/ALTER TABLE\s+operators\s+ADD COLUMN[\s\S]*totp_enrolled_at\s+TIMESTAMPTZ/i);
  });

  it('totp_secret nullable: в строке ADD COLUMN нет NOT NULL и нет DEFAULT', () => {
    const addLine = sql()
      .split('\n')
      .find((l) => /ADD COLUMN/i.test(l) && /totp_secret/i.test(l));
    expect(addLine, 'строка ADD COLUMN totp_secret').toBeTruthy();
    expect(addLine!).not.toMatch(/NOT NULL/i);
    expect(addLine!).not.toMatch(/DEFAULT/i);
  });

  it('документирует NULL totp_secret = 2FA не настроена', () => {
    expect(sql()).toMatch(/COMMENT ON COLUMN operators\.totp_secret/i);
    expect(sql()).toMatch(/NULL\s*=\s*2FA не настроена/i);
  });

  it('никакой денежной колонки сюда не заводится (Р-396)', () => {
    expect(sql()).not.toMatch(/balance|amount|cents|currency/i);
  });
});
