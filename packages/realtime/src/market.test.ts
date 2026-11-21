import { describe, expect, it } from 'vitest';
import { quoteState } from './freshness';
import { parseQuoteBatch } from './parse-quote-batch';
import { displayPrice, formatNextOpen, marketsOf, parseQuotesState, staleSymbolsOf } from './quote-reasons';
import type { Quote } from './types';

const NEXT_OPEN = 1_795_284_000_000;

const raw = (over: Record<string, unknown> = {}) => ({
  symbol: 'EURUSD',
  name: 'Euro / US Dollar',
  category: 'forex',
  price: 1.08412,
  digits: 5,
  changePercent: -0.1,
  bid: 1.0841,
  ask: 1.08414,
  ts: 1_795_000_000_000,
  source: 'modulev2',
  ...over,
});

describe('закрытый рынок · /v1/quotes', () => {
  it('market-closed и market-halted — известные причины, nextOpen разобран', () => {
    const state = parseQuotesState({
      unavailable: [
        { symbol: 'EURUSD', reason: 'market-closed', nextOpen: NEXT_OPEN },
        { symbol: 'AAPL', reason: 'market-halted', nextOpen: null },
        { symbol: 'XAUUSD', reason: 'market-closed', nextOpen: 'завтра' },
      ],
      missing: [],
    });

    expect(state.unavailable).toEqual([
      { symbol: 'EURUSD', reason: 'market-closed', nextOpen: NEXT_OPEN },
      { symbol: 'AAPL', reason: 'market-halted', nextOpen: null },
      { symbol: 'XAUUSD', reason: 'market-closed', nextOpen: null },
    ]);
    expect(marketsOf(state).get('EURUSD')).toEqual({ status: 'closed', reason: null, nextOpen: NEXT_OPEN });
    expect(marketsOf(state).get('AAPL')?.status).toBe('halted');
    expect(staleSymbolsOf(state).has('EURUSD')).toBe(true);
  });
});

describe('закрытый рынок · поток quotes:batch', () => {
  it('поле market — известное, не новинка, котировка с ним принимается', () => {
    const parsed = parseQuoteBatch([raw({ market: { status: 'closed', reason: 'weekend', nextOpen: NEXT_OPEN } })]);

    expect(parsed.novelties).toEqual([]);
    expect(parsed.rejected).toEqual([]);
    expect(parsed.quotes[0]?.market).toEqual({ status: 'closed', reason: 'weekend', nextOpen: NEXT_OPEN });
  });

  it('негодное market не губит цену, а записывается отказом поля', () => {
    const parsed = parseQuoteBatch([raw({ market: { status: 'sleeping' } }), raw({ symbol: 'GBPUSD', market: 'closed' })]);

    expect(parsed.quotes.map((q) => q.market)).toEqual([undefined, undefined]);
    expect(parsed.rejected.map((r) => [r.symbol, r.field, r.reason])).toEqual([
      ['EURUSD', 'market', 'unknown-value'],
      ['GBPUSD', 'market', 'wrong-type'],
    ]);
  });

  it('без market котировка прежняя', () => {
    expect(parseQuoteBatch([raw()]).quotes[0]).not.toHaveProperty('market');
  });
});

describe('закрытый рынок · показ', () => {
  const now = 1_795_100_000_000;
  const quote = (over: Partial<Quote> = {}): Quote => ({ ...(parseQuoteBatch([raw()]).quotes[0] as Quote), ...over });

  it('последняя цена со старым ts не гасится: состояние closed, цена показывается', () => {
    const q = quote({ market: { status: 'closed', reason: 'weekend', nextOpen: NEXT_OPEN } });

    expect(quoteState(q, { feedStatus: 'connected', staleAfterMs: 20_000, staleSymbols: new Set(['EURUSD']), now })).toBe('closed');
    expect(displayPrice(q, (p, d) => p.toFixed(d))).toBe('1.08412');
  });

  it('halted — своё состояние', () => {
    expect(quoteState(quote({ market: { status: 'halted', reason: null, nextOpen: null } }), { feedStatus: 'connected', now })).toBe('halted');
  });

  it('рынок закрыт по ответу /v1/quotes, а в котировке поля нет', () => {
    const markets = new Map([['EURUSD', { status: 'closed' as const, reason: null, nextOpen: null }]]);

    expect(quoteState(quote(), { feedStatus: 'connected', staleAfterMs: 20_000, markets, now })).toBe('closed');
  });

  it('открытый рынок со старой ценой — по-прежнему unavailable', () => {
    expect(quoteState(quote({ market: { status: 'open', reason: null, nextOpen: null } }), { feedStatus: 'connected', staleAfterMs: 20_000, now })).toBe('unavailable');
  });

  it('цены не было вовсе — закрытый рынок её не выдумывает', () => {
    expect(quoteState(quote({ ts: 0, market: { status: 'closed', reason: null, nextOpen: null } }), { feedStatus: 'connected', now })).toBe('unavailable');
  });

  it('время открытия — в поясе посетителя', () => {
    expect(formatNextOpen(Date.UTC(2026, 10, 23, 22, 0), 'ru-RU', 'Europe/Moscow')).toMatch(/01:00/);
    expect(formatNextOpen(Date.UTC(2026, 10, 23, 22, 0), 'en-US', 'America/New_York')).toMatch(/05:00 PM/);
  });
});
