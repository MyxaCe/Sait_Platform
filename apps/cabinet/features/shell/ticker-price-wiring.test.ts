import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const TICKER = path.resolve(__dirname, 'CabinetTicker.tsx');

const code = readFileSync(TICKER, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('CabinetTicker · цена берётся общим правилом', () => {
  it('зовёт displayPrice, а не форматирует цену сам', () => {
    expect(code).toMatch(/price:\s*displayPrice\(/);
  });

  it('не подставляет formatPrice прямо в элемент ленты', () => {
    expect(code).not.toMatch(/price:\s*formatPrice\(/);
  });
});
