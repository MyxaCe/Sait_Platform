import { describe, expect, it } from 'vitest';
import { parseUsdtAmountToCents } from '@broker/money';
import { parseAmount } from './amount';

/** Клиентская подсказка не должна расходиться с сервером ни в одном исходе. */
describe('разбор суммы на клиенте = сервер', () => {
  const cases = ['', ' ', '12', '12.5', '12,50', '1 000,25', '0', '0.00', '0.001', 'abc', '-5', '1e3', '10000000', '10000000.01', '25.'];
  for (const input of cases) {
    it(JSON.stringify(input), () => {
      expect(parseAmount(input)).toEqual(parseUsdtAmountToCents(input));
    });
  }
});
