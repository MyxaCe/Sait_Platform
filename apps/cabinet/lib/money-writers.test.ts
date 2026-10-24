import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Кабинет не пишет деньги — только отражает (WEB-29, решение владельца).
 *
 * > Владелец денежного числа — терминал. Кабинет — проекция. Сброс
 * > демо-счёта, изменение баланса, любая денежная операция — через
 * > терминал.
 *
 * **Зачем сторож до ручки.** Переделка ждёт `TRM-54`: чинить сброс,
 * которому некуда ходить, нечем. Но свойство «новых писателей не
 * появляется» от ручки не зависит, и поймать нарушителя дешевле сейчас,
 * чем разбирать его потом вместе с остальным.
 *
 * **Почему со списком, а не строгим запретом.** Строгий запрет покраснел
 * бы сегодня же: два писателя живы и законны до `TRM-54`. Гейт, который
 * невозможно удовлетворить, либо обходят, либо он красит основную — и
 * второе мы только что прожили три дня (Р-264). Поэтому нынешние
 * писатели названы поимённо, с датой смерти, а любой **новый** краснит
 * проверку.
 *
 * Список — не послабление: он короткий, каждый пункт назван, и когда
 * `TRM-54` закроется, он обязан опустеть. Пустой список превращает эту
 * проверку в тот самый строгий запрет, ради которого она и писалась.
 */

const CABINET = path.resolve(__dirname, '..');
const SKIP = new Set(['node_modules', '.next']);

/** Поля, которые принадлежат терминалу. */
const MONEY_FIELDS = ['balance_cents'];

/**
 * Писатели, живые до `TRM-54`. Каждый уйдёт: сброс — в ручку терминала,
 * создание строки — в проекцию по `terminal.account.opened`.
 */
const ALLOWED_UNTIL_TRM_54 = ['lib/actions.ts', 'lib/auth/register.ts'];

/** Запись в таблицу денег: INSERT или UPDATE, но не SELECT. */
function writesMoney(line: string): boolean {
  if (!/demo_accounts/.test(line)) return false;
  if (!/(INSERT\s+INTO|UPDATE)\s/i.test(line)) return false;
  return MONEY_FIELDS.some((f) => line.includes(f)) || /INSERT\s+INTO\s+demo_accounts/i.test(line);
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry) && !entry.includes('.test.')) out.push(full);
  }
  return out;
}

export function moneyWriters(): string[] {
  const found: string[] = [];
  for (const file of sourceFiles(CABINET)) {
    const relative = path.relative(CABINET, file).split(path.sep).join('/');
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
      if (writesMoney(line)) found.push(`${relative}:${i + 1}`);
    });
  }
  return found;
}

describe('WEB-29 · кабинет не пишет в денежные поля', () => {
  it('новых писателей нет — только названные, и они уйдут с TRM-54', () => {
    const unexpected = moneyWriters().filter(
      (place) => !ALLOWED_UNTIL_TRM_54.some((allowed) => place.startsWith(allowed)),
    );

    expect(unexpected).toEqual([]);
  });

  it('названные писатели ещё на месте — список не протух', () => {
    // Растяжка в обратную сторону. Если писателя убрали, а строку в
    // списке забыли, список начинает разрешать то, чего нет, и однажды
    // разрешит нового писателя в том же файле. Поэтому список обязан
    // соответствовать действительности в обе стороны.
    const places = moneyWriters();

    for (const allowed of ALLOWED_UNTIL_TRM_54) {
      expect(
        places.some((p) => p.startsWith(allowed)),
        `${allowed} больше не пишет деньги — убери его из списка (TRM-54 закрыт?)`,
      ).toBe(true);
    }
  });

  it('проверка умеет краснеть', () => {
    expect(writesMoney("`UPDATE demo_accounts SET balance_cents = $1 WHERE user_id = $2`")).toBe(
      true,
    );
    expect(writesMoney('`INSERT INTO demo_accounts (user_id, balance_cents) VALUES ($1, $2)`')).toBe(
      true,
    );

    // Чтение — не запись: кабинет отражает, и смотреть ему можно.
    expect(writesMoney('`SELECT balance_cents, currency FROM demo_accounts WHERE user_id = $1`')).toBe(
      false,
    );
    // Чужая таблица не считается.
    expect(writesMoney('`UPDATE demo_positions SET volume = $1`')).toBe(false);
  });
});
