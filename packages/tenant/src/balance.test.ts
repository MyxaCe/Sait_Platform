import { describe, expect, it } from 'vitest';
import { readStartBalance, type TenantStartBalance } from './balance';

const LEGACY_DEFAULT = 1_000_000;

describe('источник назвал сумму', () => {
  it('целое → берём как есть', () => {
    expect(readStartBalance(500_000)).toEqual({ state: 'set', cents: 500_000 });
  });

  it('ноль — допустимая назначенная сумма, а не отсутствие суммы', () => {
    expect(readStartBalance(0)).toEqual({ state: 'set', cents: 0 });
  });
});

describe('источник сказал «не задан»', () => {
  it('null → unset, и это НЕ сумма', () => {
    expect(readStartBalance(null)).toEqual({ state: 'unset' });
  });

  it('РАСТЯЖКА: null не превращается в умолчание legacy ни при каких условиях', () => {
    const result = readStartBalance(null);

    expect(result).not.toEqual({ state: 'set', cents: LEGACY_DEFAULT });
    expect(result.state).not.toBe('set');
  });
});

describe('в поле не сумма', () => {
  it.each([
    ['поля нет вовсе', undefined],
    ['строка с числом', '1000000'],
    ['строка NaN', 'NaN'],
    ['NaN', Number.NaN],
    ['бесконечность', Number.POSITIVE_INFINITY],
    ['дробное', 1000.5],
    ['отрицательное', -1],
    ['за пределами целого', Number.MAX_SAFE_INTEGER + 2],
    ['объект', {}],
    ['true', true],
  ])('%s → unavailable:malformed, а не ноль и не умолчание', (_name, raw) => {
    const result = readStartBalance(raw);

    expect(result).toEqual({ state: 'unavailable', reason: 'malformed' });
  });

  it('РАСТЯЖКА: строка «1000000» из numeric-поля базы — не сумма', () => {
    expect(readStartBalance('1000000').state).toBe('unavailable');
  });

  it('РАСТЯЖКА: ни один вход не даёт `set` с суммой, которой не было во входе', () => {
    const inputs: unknown[] = [null, undefined, 'NaN', '500000', Number.NaN, {}, [], true, -5];

    for (const raw of inputs) {
      const result: TenantStartBalance = readStartBalance(raw);
      expect(result.state).not.toBe('set');
    }
  });
});
