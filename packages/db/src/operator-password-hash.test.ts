import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ADM-01 · пароль оператора добавляется отдельной миграцией и остаётся
 * nullable (Р-451, Р-394).
 *
 * Живого наката в прогоне пакета нет (как и у `admin-center-foundation`):
 * тесты читают текст миграции. Проверяется то, что легче всего потерять
 * при правке и что меняет смысл безопасности:
 *
 *  - колонка именно ДОБАВЛЯЕТСЯ (ALTER), а не вписана в прежнюю миграцию —
 *    применённую миграцию не переписывают;
 *  - колонка NULLABLE — NULL это «входа нет» (fail-closed), а не пустой
 *    пароль. Появись тут NOT NULL с умолчанием — вход открылся бы по
 *    пустому/дефолтному хешу.
 */

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
    // Берём именно строку с ADD COLUMN password_hash, а не весь файл
    // (в комментариях слова NOT NULL / DEFAULT встречаются как пояснение).
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
