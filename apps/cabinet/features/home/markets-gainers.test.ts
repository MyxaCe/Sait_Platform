import { describe, expect, it } from 'vitest';
import type { Quote } from '@broker/realtime';
import { selectGainers } from './markets-gainers';

function quote(symbol: string, changePercent: number | null): Quote {
  return {
    symbol,
    name: symbol,
    category: 'crypto',
    price: 100,
    digits: 2,
    changePercent,
    // Книга заявок к отбору лидеров роста отношения не имеет (WEB-36).
    bid: null,
    ask: null,
    ts: 1_700_000_000_000,
  };
}

describe('selectGainers · пустое изменение не делает инструмент лидером роста', () => {
  it('инструмент с неизвестным изменением во вкладку не попадает', () => {
    const rows = selectGainers([quote('AAA', 1.5), quote('BBB', null)]);

    expect(rows.map((q) => q.symbol)).toEqual(['AAA']);
  });

  it('пустое изменение не выдаётся за рост, даже когда растущих нет совсем', () => {
    // Иначе вкладка «Лидеры роста» показала бы инструмент, про который мы не
    // знаем, растёт ли он, — то самое утверждение, которого делать нельзя.
    expect(selectGainers([quote('AAA', null), quote('BBB', null)])).toEqual([]);
  });

  it('порядок по убыванию сохраняется и не ломается соседством пустых', () => {
    // Если бы `null` дошёл до компаратора, `null - null` дал бы NaN, а
    // компаратор с NaN рвёт порядок молча: падение невоспроизводимо и
    // зависит от длины массива и реализации сортировки.
    const rows = selectGainers([
      quote('LOW', 0.4),
      quote('EMPTY', null),
      quote('HIGH', 5.1),
      quote('MID', 2.2),
      quote('ALSO_EMPTY', null),
    ]);

    expect(rows.map((q) => q.symbol)).toEqual(['HIGH', 'MID', 'LOW']);
  });

  it('ноль и падение остаются за бортом — это про рост, а не про известность', () => {
    // Ноль — известное изменение, и оно не рост. Пустое значение отсеивается
    // по другой причине, и смешивать эти причины нельзя.
    expect(selectGainers([quote('ZERO', 0), quote('DOWN', -3.2)])).toEqual([]);
  });

  it('исходный массив не мутируется — сортировка идёт по копии', () => {
    const input = [quote('LOW', 0.4), quote('HIGH', 5.1)];
    selectGainers(input);

    expect(input.map((q) => q.symbol)).toEqual(['LOW', 'HIGH']);
  });
});
