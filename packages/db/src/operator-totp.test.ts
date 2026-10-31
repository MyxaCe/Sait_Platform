import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ADM-13 · второй фактор (TOTP) добавляется отдельной миграцией, оба столбца
 * nullable (Р-454 III-3, Р-394).
 *
 * Живого наката в прогоне нет (как у соседних миграций зоны): тест читает текст
 * миграции и стережёт то, что меняет смысл безопасности:
 *
 *  - колонки ДОБАВЛЯЮТСЯ (ALTER), а не вписаны в прежнюю миграцию;
 *  - `totp_secret` NULLABLE — NULL это «2FA не настроена» (суперадмин «с
 *    первого дня» входит по паролю и ведётся на enrollment), а не включённый
 *    второй фактор с пустым секретом;
 *  - никакой денежной колонки (Р-396).
 */

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
