import { describe, expect, it } from 'vitest';
import { parseClosedDeal, parseClosedDeals, unscale } from './closed-deals';

/**
 * CAB-09 · преобразование целых чисел терминала.
 *
 * Проверяется отдельно, потому что это ровно то место, где ошибка **не
 * краснеет нигде**: числа остаются числами, обе стороны зелены, а человек
 * видит цену в сто тысяч раз больше или прибыль в тысячи раз меньше.
 */

/** Ответ ручки как он есть: целые, snake_case, поля могут отсутствовать. */
const RAW = {
  instrument: 1,
  symbol: 'EURUSD',
  side: 'sell',
  qty: 10, // 0.10 при qty_decimals = 2
  entry: 108500, // 1.08500 при price_decimals = 5
  exit: 108200,
  pnl: -1234, // центы: −$12.34
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
    // Перепутать две точности легко: обе лежат в одной записи.
    const d = parseClosedDeal(RAW)!;

    expect(d.volume).toBe(0.1);
  });

  it('`pnl` НЕ масштабируется точностью цены — это центы', () => {
    // Главная ловушка. `pnl` — деньги, а не котировка. Поделив его на
    // 10^5, мы показали бы −$0.01 вместо −$12.34 и ничего бы не
    // покраснело: число осталось числом.
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
    // Поля нет — НЕ «разрыва не было»: `false` отвечал бы за прошлое,
    // которого мы не видели.
    expect(parseClosedDeal(withoutGap)!.acrossGap).toBeNull();
  });

  it('`false` не превращается в «неизвестно»', () => {
    // Растяжка против проверки на истинность: `across_gap: false` —
    // проверили и разрыва не было, это знание, а не его отсутствие.
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
