import { describe, expect, it } from 'vitest';
import { describeSlippage } from './slippage';

const EURUSD = { digits: 5 } as const;

describe('describeSlippage · направление', () => {
  it('была ДЛИННАЯ, закрылась ниже уровня — против клиента', () => {
    expect(
      describeSlippage({ execution: 1.082, level: 1.085, side: 'buy', ...EURUSD }),
    ).toEqual({ kind: 'against', amount: 0.003 });
  });

  it('была ДЛИННАЯ, закрылась выше уровня — в пользу клиента', () => {
    expect(
      describeSlippage({ execution: 1.087, level: 1.085, side: 'buy', ...EURUSD }),
    ).toEqual({ kind: 'favour', amount: 0.002 });
  });

  it('была КОРОТКАЯ, закрылась выше уровня — против клиента', () => {
    expect(
      describeSlippage({ execution: 1.088, level: 1.085, side: 'sell', ...EURUSD }),
    ).toEqual({ kind: 'against', amount: 0.003 });
  });

  it('была КОРОТКАЯ, закрылась ниже уровня — в пользу клиента', () => {
    expect(
      describeSlippage({ execution: 1.083, level: 1.085, side: 'sell', ...EURUSD }),
    ).toEqual({ kind: 'favour', amount: 0.002 });
  });
});

describe('describeSlippage · когда говорить нечего', () => {
  it('исполнение ровно по уровню — молчим', () => {
    expect(
      describeSlippage({ execution: 1.0850, level: 1.0850, side: 'sell', ...EURUSD }),
    ).toEqual({ kind: 'none', amount: 0 });
  });

  it('разница ниже видимой точности — молчим', () => {
    expect(
      describeSlippage({ execution: 1.08501, level: 1.085, side: 'sell', digits: 3 }),
    ).toEqual({ kind: 'none', amount: 0 });
  });

  it('но на своей точности та же разница названа', () => {
    expect(
      describeSlippage({ execution: 1.08501, level: 1.085, side: 'sell', digits: 5 }).kind,
    ).toBe('against');
  });
});

describe('describeSlippage · величина', () => {
  it('величина — модуль разницы, без знака в числе', () => {
    const against = describeSlippage({
      execution: 1.082,
      level: 1.085,
      side: 'sell',
      ...EURUSD,
    });

    expect(against.amount).toBeGreaterThan(0);
  });

  it('величина округляется до видимой точности, а не тянет хвост', () => {
    const v = describeSlippage({ execution: 1.082, level: 1.085, side: 'sell', ...EURUSD });

    expect(String(v.amount).length).toBeLessThanOrEqual(7);
  });

  it('работает на инструменте с другой точностью', () => {
    expect(
      describeSlippage({ execution: 2401.5, level: 2403.0, side: 'buy', digits: 2 }),
    ).toEqual({ kind: 'against', amount: 1.5 });
  });
});

describe('describeSlippage · уровня нет (CAB-10)', () => {
  it('уровень пустой → `unknown`, а не «исполнено ровно»', () => {
    expect(
      describeSlippage({ execution: 1.085, level: null, side: 'sell', ...EURUSD }),
    ).toEqual({ kind: 'unknown', amount: 0 });
  });

  it('уровень не передан вовсе → тоже `unknown`', () => {
    expect(
      describeSlippage({ execution: 1.085, level: undefined, side: 'sell', ...EURUSD }),
    ).toEqual({ kind: 'unknown', amount: 0 });
  });

  it('`unknown` отличим от `none` — это разные утверждения', () => {
    const unknown = describeSlippage({ execution: 1.085, level: null, side: 'sell', ...EURUSD });
    const none = describeSlippage({ execution: 1.085, level: 1.085, side: 'sell', ...EURUSD });

    expect(unknown.kind).not.toBe(none.kind);
  });

  it('ноль уровня — это уровень, а не его отсутствие', () => {
    expect(describeSlippage({ execution: 0, level: 0, side: 'sell', digits: 2 }).kind).toBe(
      'none',
    );
  });
});
