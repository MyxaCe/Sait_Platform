import { describe, expect, it } from 'vitest';
import {
  formatChangePercent,
  formatCompact,
  formatCurrency,
  formatPrice,
} from './format';

describe('formatCurrency', () => {
  it('форматирует доллары с двумя знаками', () => {
    expect(formatCurrency(1234.5)).toBe('$1,234.50');
  });

  it('поддерживает другие валюты', () => {
    expect(formatCurrency(100, 'EUR')).toContain('100');
  });
});

describe('formatPrice', () => {
  it('держит фиксированную точность (нет CLS от прыгающей ширины)', () => {
    expect(formatPrice(1.0842, 5)).toBe('1.08420');
    expect(formatPrice(157.34, 3)).toBe('157.340');
  });

  it('округляет до целого при digits=0', () => {
    expect(formatPrice(67450.4, 0)).toBe('67,450');
  });
});

describe('formatChangePercent', () => {
  it('положительное — со знаком плюс', () => {
    expect(formatChangePercent(1.234)).toBe('+1.23%');
  });

  it('отрицательное — с типографским минусом', () => {
    expect(formatChangePercent(-0.87)).toBe('−0.87%');
  });

  it('ноль — без знака', () => {
    expect(formatChangePercent(0)).toBe('0.00%');
  });
});

describe('formatCompact', () => {
  it('сокращает большие числа', () => {
    const result = formatCompact(87_000_000_000);
    expect(result).toMatch(/87/);
  });
});
