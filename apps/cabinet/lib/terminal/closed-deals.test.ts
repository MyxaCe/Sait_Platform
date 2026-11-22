import { describe, expect, it } from 'vitest';
import { parseClosedDeal, parseClosedDeals, unscale } from './closed-deals';

const RAW = {
  instrument: 1,
  symbol: 'EURUSD',
  side: 'sell',
  qty: 10,
  entry: 108500,
  exit: 108200,
  pnl: -1234,
  level: 108500,
  across_gap: true,
  price_decimals: 5,
  qty_decimals: 2,
};

describe('единицы: что чем масштабируется', () => {
  it('цены делятся на точность ЦЕНЫ', () => {
    const d = parseClosedDeal(RAW)!;

    expect(d.entry).toBe(1.085);
    expect(d.exit).toBe(1.082);
  });

  it('объём делится на точность ОБЪЁМА, а не цены', () => {
    const d = parseClosedDeal(RAW)!;

    expect(d.volume).toBe(0.1);
  });

  it('`pnl` НЕ масштабируется точностью цены — это центы', () => {
    const d = parseClosedDeal(RAW)!;

    expect(d.pnlCents).toBe(-1234);
  });

  it('уровень делится на точность цены, как и цены', () => {
    expect(parseClosedDeal(RAW)!.level).toBe(1.085);
  });

  it('unscale сам по себе', () => {
    expect(unscale(108425, 5)).toBe(1.08425);
    expect(unscale(240150, 2)).toBe(2401.5);
    expect(unscale(5, 0)).toBe(5);
  });
});

describe('три состояния сохраняются', () => {
  it('уровня нет → `null`, а не ноль и не цена исполнения', () => {
    const { level, ...withoutLevel } = RAW;
    void level;

    expect(parseClosedDeal(withoutLevel)!.level).toBeNull();
  });

  it('разрыв: true, false и «неизвестно» различимы', () => {
    const { across_gap, ...withoutGap } = RAW;
    void across_gap;

    expect(parseClosedDeal({ ...RAW, across_gap: true })!.acrossGap).toBe(true);
    expect(parseClosedDeal({ ...RAW, across_gap: false })!.acrossGap).toBe(false);
    expect(parseClosedDeal(withoutGap)!.acrossGap).toBeNull();
  });

  it('`false` не превращается в «неизвестно»', () => {
    expect(parseClosedDeal({ ...RAW, across_gap: false })!.acrossGap).not.toBeNull();
  });
});

describe('негодные записи', () => {
  it.each(['symbol', 'side', 'exit', 'entry', 'qty', 'pnl', 'price_decimals', 'qty_decimals'])(
    'без «%s» запись пропускается, а не показывается наполовину',
    (field) => {
      const broken: Record<string, unknown> = { ...RAW };
      delete broken[field];

      expect(parseClosedDeal(broken)).toBeNull();
    },
  );

  it('негодные выбрасываются, годные остаются', () => {
    expect(parseClosedDeals([RAW, { symbol: 'X' }, RAW])).toHaveLength(2);
  });

  it('не массив — пустой список, а не падение', () => {
    expect(parseClosedDeals(null)).toEqual([]);
    expect(parseClosedDeals({ items: [] })).toEqual([]);
  });
});
