import { describe, expect, it } from 'vitest';
import {
  centsToUsdtRaw,
  formatCentsPlain,
  formatUsdtRaw,
  parseUsdtAmountToCents,
  usdtRawToCents,
} from './amounts';

describe('USDT (6 знаков) → центы', () => {
  it('ровная сумма: 12.34 USDT = 1234 цента, остатка нет', () => {
    expect(usdtRawToCents('12340000')).toEqual({ cents: 1234n, dustRaw: 0n });
  });

  it('дробь меньше цента отбрасывается ВНИЗ и записывается', () => {
    // 12.345678 USDT → 12.34 на счёт, 0.005678 (5678 сырых) — остаток.
    expect(usdtRawToCents('12345678')).toEqual({ cents: 1234n, dustRaw: 5678n });
  });

  it('0.009999 USDT → 0 центов (зачислять нечего), весь остаток записан', () => {
    expect(usdtRawToCents(9999n)).toEqual({ cents: 0n, dustRaw: 9999n });
  });

  it('большие суммы без потери точности (BigInt)', () => {
    expect(usdtRawToCents('123456789012345678')).toEqual({ cents: 12345678901234n, dustRaw: 5678n });
  });

  it('мусор вместо числа — исключение, а не NaN', () => {
    expect(() => usdtRawToCents('12.5')).toThrow();
    expect(() => usdtRawToCents('-1')).toThrow();
  });

  it('центы → сырые единицы для сверки выплаты', () => {
    expect(centsToUsdtRaw(1234)).toBe(12340000n);
  });
});

describe('ввод суммы человеком', () => {
  it.each([
    ['12', 1200],
    ['12.5', 1250],
    ['12,50', 1250],
    ['0.01', 1],
    [' 1 000.10 ', 100010],
  ])('%s → %i центов', (input, cents) => {
    expect(parseUsdtAmountToCents(input)).toEqual({ ok: true, cents });
  });

  it.each([
    ['', 'empty'],
    ['abc', 'invalid'],
    ['1.234', 'tooPrecise'],
    ['0', 'notPositive'],
    ['0.00', 'notPositive'],
    ['-5', 'invalid'],
    ['99999999999', 'tooLarge'],
  ])('%s → отказ %s', (input, reason) => {
    expect(parseUsdtAmountToCents(input)).toEqual({ ok: false, reason });
  });
});

describe('показ', () => {
  it('центы и сырые единицы', () => {
    expect(formatCentsPlain(123456)).toBe('1 234.56');
    expect(formatUsdtRaw('12345678')).toBe('12.345678');
    expect(formatUsdtRaw('12000000')).toBe('12');
  });
});
