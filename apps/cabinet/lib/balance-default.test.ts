import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * WEB-29 · у баланса нет умолчания в схеме (Р-040).
 *
 * `DEFAULT 1000000` выдавал десять тысяч долларов любому INSERT без
 * колонки. Оба создателя строки передают сумму явно, поэтому умолчание
 * мертво — но мертво оно только пока. Регистрация при незаданной сумме
 * тенанта **отказывает** (Р-040), и умолчание в базе отменило бы этот
 * отказ молча: строка появилась бы, с чужой суммой и без следа.
 *
 * Проверяется по схеме, потому что поведением не ловится: пока никто не
 * вставляет строку без колонки, умолчание невидимо.
 */

const ROOT = path.resolve(__dirname, '../../..');
const schema = () => readFileSync(path.join(ROOT, 'db/init/002_cabinet.sql'), 'utf8');

/** Строки объявления колонки, без комментариев. */
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
    // Растяжка: убрать умолчание и заодно разрешить NULL значило бы
    // заменить одну тихую подстановку другой.
    expect(balanceColumn(schema())).toMatch(/NOT NULL/);
  });

  it('проверка умеет краснеть', () => {
    expect(balanceColumn('  balance_cents BIGINT NOT NULL DEFAULT 1000000,')).toMatch(/DEFAULT/i);
    // И не обманывается комментарием, который упоминает умолчание.
    expect(
      balanceColumn('  -- было DEFAULT 1000000\n  balance_cents BIGINT NOT NULL,'),
    ).not.toMatch(/DEFAULT/i);
  });
});
