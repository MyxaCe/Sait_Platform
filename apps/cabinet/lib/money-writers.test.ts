import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const CABINET = path.resolve(__dirname, '..');
const SKIP = new Set(['node_modules', '.next']);

const MONEY_FIELDS = ['balance_cents'];

const ALLOWED: readonly string[] = [];

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
    expect(ALLOWED).toEqual([]);
  });

  it('сканер доходит до файлов, а не зелен из-за пустого обхода', () => {
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

    expect(writesMoney('`SELECT balance_cents, currency FROM demo_accounts WHERE user_id = $1`')).toBe(
      false,
    );
    expect(writesMoney('`UPDATE demo_positions SET volume = $1`')).toBe(false);
  });
});
