import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = __dirname;

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function sources(): { file: string; code: string }[] {
  return readdirSync(DIR)
    .filter((e) => (e.endsWith('.ts') || e.endsWith('.tsx')) && !e.includes('.test.'))
    .filter((e) => statSync(path.join(DIR, e)).isFile())
    .map((e) => ({ file: e, code: stripComments(readFileSync(path.join(DIR, e), 'utf8')) }));
}

describe('лента котировок · цена берётся общим правилом', () => {
  it('скан доходит до файлов, а не зелен из-за пустой папки', () => {
    const files = sources().map((s) => s.file);

    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain('QuotesTicker.tsx');
  });

  it('общее правило зовут — хотя бы в одном файле папки', () => {
    expect(sources().some((s) => /price:\s*displayPrice\(/.test(s.code))).toBe(true);
  });

  it('цена элемента ленты не форматируется в обход правила', () => {
    const offenders = sources()
      .filter((s) => /price:\s*formatPrice\(/.test(s.code))
      .map((s) => s.file);

    expect(offenders).toEqual([]);
  });

  it('порог «настоящего чтения не было» не переписан на месте', () => {
    const offenders = sources()
      .filter((s) => /\bts\s*===\s*0\b/.test(s.code))
      .map((s) => s.file);

    expect(offenders).toEqual([]);
  });

  it('проверка умеет и краснеть, и молчать', () => {
    const red = /price:\s*formatPrice\(/;
    const inlined = /\bts\s*===\s*0\b/;

    expect(red.test('price: formatPrice(q.price, q.digits),')).toBe(true);
    expect(inlined.test('price: q.ts === 0 ? null : formatPrice(q.price, q.digits),')).toBe(true);

    expect(red.test('price: displayPrice(q, formatPrice),')).toBe(false);
    expect(inlined.test('price: displayPrice(q, formatPrice),')).toBe(false);
  });
});
