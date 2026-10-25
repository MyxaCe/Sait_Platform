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
 * **Список опустел — запрет стал строгим** (25.10, `TRM-54` закрыт).
 *
 * Сторож писался со списком нарочно: строгий запрет покраснел бы в
 * день написания, потому что два писателя были живы и законны. Гейт,
 * который невозможно удовлетворить, либо обходят, либо он красит
 * основную ветку — второе мы прожили три дня (Р-264). Поэтому
 * писатели были названы поимённо, с датой смерти, а любой **новый**
 * краснил проверку с первого дня.
 *
 * Сегодня оба ушли: сброс — в ручку терминала, создание строки — в
 * проекцию по `terminal.account.opened`. **Список пуст, и это тот
 * самый строгий запрет, ради которого всё писалось** — дошедший до
 * строгости без единого красного дня.
 *
 * **Вторая половина сторожа сработала сама.** Проверка «названные
 * писатели ещё на месте» покраснела в тот момент, когда я убрал
 * второго, и сказала «убери его из списка». Список не мог протухнуть
 * молча — а протухший разрешал бы будущего писателя в том же файле.
 */

const CABINET = path.resolve(__dirname, '..');
const SKIP = new Set(['node_modules', '.next']);

/** Поля, которые принадлежат терминалу. */
const MONEY_FIELDS = ['balance_cents'];

/**
 * Писателей не осталось. **Список пуст и обязан таким оставаться.**
 *
 * Пополнять его — значит возвращать кабинету право писать деньги.
 * Если такое понадобится, это решение владельца, а не правка файла с
 * проверкой.
 */
const ALLOWED: readonly string[] = [];

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
  it('кабинет не пишет деньги НИГДЕ', () => {
    const unexpected = moneyWriters().filter(
      (place) => !ALLOWED.some((allowed) => place.startsWith(allowed)),
    );

    expect(unexpected).toEqual([]);
  });

  it('список исключений ПУСТ — и это предмет проверки, а не следствие', () => {
    // Иначе запрет тихо ослабят одной строкой в этом же файле, и
    // проверка останется зелёной, продолжая называться строгой.
    expect(ALLOWED).toEqual([]);
  });

  it('сканер доходит до файлов, а не зелен из-за пустого обхода', () => {
    // Пустой запрет и сломанный обход дают одинаково зелёный ответ.
    // Различить их можно только спросив, сколько файлов осмотрено.
    const files = sourceFiles(CABINET);

    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.endsWith('actions.ts'))).toBe(true);
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
