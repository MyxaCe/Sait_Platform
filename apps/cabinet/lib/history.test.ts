import { describe, expect, it } from 'vitest';
import { parsePeriod, periodStart, summarizeTrades } from './history';

describe('сводка истории сделок', () => {
  it('оборот = Σ объём × цена; P&L и винрейт — только по закрывающим', () => {
    const s = summarizeTrades([
      { volume: 0.1, price: 64000, realizedPnlCents: null }, // открытие: 6 400,00
      { volume: 0.1, price: 65000, realizedPnlCents: 10_000 }, // +100,00
      { volume: 10_000, price: 1.08, realizedPnlCents: -2_500 }, // −25,00
      { volume: 5, price: 200, realizedPnlCents: 0 }, // ноль — не победа
    ]);
    expect(s.trades).toBe(4);
    expect(s.turnoverMinor).toBe(640_000 + 650_000 + 1_080_000 + 100_000);
    expect(s.pnlMinor).toBe(7_500);
    expect(s.closed).toBe(3);
    expect(s.wins).toBe(1);
    expect(s.winRate).toBeCloseTo(1 / 3);
  });

  it('нет закрытий — винрейта нет (а не 0 %)', () => {
    expect(summarizeTrades([{ volume: 1, price: 1, realizedPnlCents: null }]).winRate).toBeNull();
    expect(summarizeTrades([]).winRate).toBeNull();
  });
});

describe('период', () => {
  it('неизвестное значение → 30 дней', () => {
    expect(parsePeriod(undefined)).toBe('30d');
    expect(parsePeriod('1y')).toBe('30d');
    expect(parsePeriod('all')).toBe('all');
  });
  it('начало периода', () => {
    const now = new Date('2026-11-10T12:00:00Z');
    expect(periodStart('7d', now)?.toISOString()).toBe('2026-11-03T12:00:00.000Z');
    expect(periodStart('all', now)).toBeNull();
  });
});
