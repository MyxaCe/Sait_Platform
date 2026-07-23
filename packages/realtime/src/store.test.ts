import { beforeEach, describe, expect, it } from 'vitest';
import { createInitialQuotes, SYMBOL_UNIVERSE } from './data';
import { useQuotesStore } from './store';
import type { Quote } from './types';

const testQuote: Quote = {
  symbol: 'EURUSD',
  name: 'Euro / US Dollar',
  category: 'forex',
  price: 1.09,
  digits: 5,
  changePercent: 0.5,
  ts: 1_700_000_000_000,
};

beforeEach(() => {
  useQuotesStore.setState({ quotes: createInitialQuotes(), status: 'connecting' });
});

describe('quotes store', () => {
  it('начальный снапшот содержит весь справочник (SSR без пустых цен)', () => {
    const { quotes } = useQuotesStore.getState();
    expect(Object.keys(quotes)).toHaveLength(SYMBOL_UNIVERSE.length);
    expect(quotes.EURUSD?.price).toBeGreaterThan(0);
    expect(quotes.EURUSD?.ts).toBe(0);
  });

  it('applyBatch обновляет только пришедшие символы', () => {
    const before = useQuotesStore.getState().quotes.BTCUSD;
    useQuotesStore.getState().applyBatch([testQuote]);
    const after = useQuotesStore.getState();
    expect(after.quotes.EURUSD?.price).toBe(1.09);
    expect(after.quotes.BTCUSD).toEqual(before);
  });

  it('setStatus меняет статус соединения', () => {
    useQuotesStore.getState().setStatus('connected');
    expect(useQuotesStore.getState().status).toBe('connected');
  });
});
