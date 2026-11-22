import { describe, expect, it } from 'vitest';
import {
  displayPrice,
  isSymbolUnavailableReason,
  parseQuotesState,
  staleSymbolsOf,
  SYMBOL_UNAVAILABLE_REASONS,
} from './quote-reasons';

const CONTRACT_SYMBOL_AXIS = [
  'registry-unreadable',
  'no-source',
  'source-disabled',
  'source-silent',
  'stale',
  'not-in-catalog',
  'threshold-unset',
  'market-closed',
  'market-halted',
];

const CONTRACT_CHANNEL_AXIS = ['not-configured', 'network', 'http-error', 'malformed', 'empty'];

describe('ось символа · перечень совпадает с контрактом', () => {
  it('состав тот же, что в §4г', () => {
    expect([...SYMBOL_UNAVAILABLE_REASONS].sort()).toEqual([...CONTRACT_SYMBOL_AXIS].sort());
  });

  it('стиль один — kebab-case, без `snake_case`', () => {
    for (const reason of SYMBOL_UNAVAILABLE_REASONS) {
      expect(reason).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
      expect(reason).not.toContain('_');
    }
  });

  it('оси не пересекаются именами, кроме согласованного совпадения', () => {
    const overlap = SYMBOL_UNAVAILABLE_REASONS.filter((r) =>
      CONTRACT_CHANNEL_AXIS.includes(r),
    ) as string[];

    expect(overlap).toEqual([]);
  });

  it('перечень живёт в рантайме, а не только в типе', () => {
    expect(Array.isArray(SYMBOL_UNAVAILABLE_REASONS)).toBe(true);
    expect(SYMBOL_UNAVAILABLE_REASONS.length).toBe(9);
  });

  it('распознаёт только имена контракта', () => {
    expect(isSymbolUnavailableReason('source-silent')).toBe(true);
    expect(isSymbolUnavailableReason('source_silent')).toBe(false);
    expect(isSymbolUnavailableReason('whatever')).toBe(false);
    expect(isSymbolUnavailableReason(undefined)).toBe(false);
  });
});

describe('разбор ответа /v1/quotes', () => {
  it('читает причину по каждому символу', () => {
    const state = parseQuotesState({
      unavailable: [
        { symbol: 'EURUSD', reason: 'source-silent' },
        { symbol: 'XAUUSD', reason: 'stale' },
      ],
      missing: ['BTCUSD'],
    });

    expect(state.unavailable).toEqual([
      { symbol: 'EURUSD', reason: 'source-silent' },
      { symbol: 'XAUUSD', reason: 'stale' },
    ]);
    expect(state.missing).toEqual(['BTCUSD']);
  });

  it('незнакомая причина СОХРАНЯЕТСЯ, а не выбрасывается молча', () => {
    const state = parseQuotesState({
      unavailable: [{ symbol: 'EURUSD', reason: 'source_silent' }],
    });

    expect(state.unavailable).toEqual([
      { symbol: 'EURUSD', reason: null, rawReason: 'source_silent' },
    ]);
  });

  it('элемент без символа отбрасывается — причина ни к чему не относится', () => {
    const state = parseQuotesState({
      unavailable: [{ reason: 'stale' }, { symbol: '', reason: 'stale' }],
    });

    expect(state.unavailable).toEqual([]);
  });

  it('мусор вместо списков читается как пустые списки, а не падает', () => {
    expect(parseQuotesState({ unavailable: 'нет', missing: 42 })).toEqual({
      unavailable: [],
      missing: [],
    });
    expect(parseQuotesState(null)).toEqual({ unavailable: [], missing: [] });
    expect(parseQuotesState(undefined)).toEqual({ unavailable: [], missing: [] });
  });

  it('пустые списки не означают «всё свежо»', () => {
    expect(staleSymbolsOf(parseQuotesState({})).size).toBe(0);
  });
});

describe('символы, которым нельзя верить', () => {
  it('`missing` входит наравне с `unavailable`', () => {
    const stale = staleSymbolsOf(
      parseQuotesState({
        unavailable: [{ symbol: 'EURUSD', reason: 'stale' }],
        missing: ['XAUUSD'],
      }),
    );

    expect([...stale].sort()).toEqual(['EURUSD', 'XAUUSD']);
  });

  it('символ с незнакомой причиной тоже недоступен', () => {
    const stale = staleSymbolsOf(
      parseQuotesState({ unavailable: [{ symbol: 'EURUSD', reason: 'source_silent' }] }),
    );

    expect(stale.has('EURUSD')).toBe(true);
  });
});

describe('displayPrice · гасить можно только настоящее чтение', () => {
  const fmt = (p: number, d: number) => p.toFixed(d);

  it('чтение было → цену отдаём, её погасит компонент', () => {
    expect(displayPrice({ price: 1.0842, digits: 4, ts: 1_700_000_000_000 }, fmt)).toBe('1.0842');
  });

  it('чтения не было (`ts = 0`) → `null`, а не зашитая базовая цена', () => {
    expect(displayPrice({ price: 1.0842, digits: 4, ts: 0 }, fmt)).toBeNull();
  });

  it('форматирование остаётся за приложением', () => {
    const calls: [number, number][] = [];
    displayPrice({ price: 2.5, digits: 2, ts: 1 }, (p, d) => {
      calls.push([p, d]);
      return 'что угодно';
    });

    expect(calls).toEqual([[2.5, 2]]);
  });

  it('при `ts = 0` форматирование даже не вызывается', () => {
    let called = false;
    displayPrice({ price: 1, digits: 2, ts: 0 }, () => {
      called = true;
      return '1.00';
    });

    expect(called).toBe(false);
  });
});
