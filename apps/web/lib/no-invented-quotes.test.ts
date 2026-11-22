import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SYMBOL_UNIVERSE } from '@broker/realtime';

const WEB = path.resolve(__dirname, '..');
const MARKETING = ['components', 'features/accounts', 'features/blog', 'features/education'];
const SKIP = new Set(['node_modules', '.next']);

const PRICE_LIKE = /'\d[\d\s ]*[.,]?\d*'/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry) && !entry.includes('.test.')) out.push(full);
  }
  return out;
}

const SYMBOLS = SYMBOL_UNIVERSE.map((d) => d.symbol);

export function offendingLines(text: string): string[] {
  const out: string[] = [];
  text.split('\n').forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    const symbol = SYMBOLS.find((s) => line.includes(`'${s}'`) || line.includes(`"${s}"`));
    if (symbol && PRICE_LIKE.test(line)) out.push(`${i + 1}: ${trimmed}`);
  });
  return out;
}

describe('WEB-25 · разметка не выдумывает котировки', () => {
  it('скан доходит до файлов', () => {
    const scanned = MARKETING.flatMap((d) => sourceFiles(path.join(WEB, d)));

    expect(scanned.length).toBeGreaterThan(10);
    expect(scanned.some((f) => f.includes('DownloadApp'))).toBe(true);
  });

  it('ни одного символа инструмента рядом с ценой в иллюстрациях', () => {
    const offenders: string[] = [];

    for (const dir of MARKETING) {
      for (const file of sourceFiles(path.join(WEB, dir))) {
        for (const line of offendingLines(readFileSync(file, 'utf8'))) {
          offenders.push(`${path.relative(WEB, file)}:${line}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('проверка умеет краснеть — на том самом, что лежало в макете', () => {
    expect(offendingLines("['EURUSD', '1.08423', '+0.14%', true],")).toHaveLength(1);
    expect(offendingLines("['BTCUSD', '67 450', '−1.08%', false],")).toHaveLength(1);
    expect(offendingLines("['XAUUSD', '2 417.50', '+0.62%', true],")).toHaveLength(1);
  });

  it('не трогает законное: символ без цены и цену без символа', () => {
    expect(offendingLines("const s = 'EURUSD';")).toEqual([]);
    expect(offendingLines("const year = '2019';")).toEqual([]);
    expect(offendingLines("    // было ['EURUSD', '1.08423'] — так нельзя")).toEqual([]);
  });
});
