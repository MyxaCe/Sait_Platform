import { describe, expect, it } from 'vitest';
import type { QuotesState } from '@broker/realtime';
import {
  agreesWithStaleSymbols,
  reasonsFromState,
  unavailableReasonsOf,
} from './unavailable-map';

const state = (over: Partial<QuotesState> = {}): QuotesState => ({
  unavailable: [],
  missing: [],
  ...over,
});

describe('WEB-39 · раскладка причин', () => {
  it('причина доезжает по символу', () => {
    const map = reasonsFromState(
      state({ unavailable: [{ symbol: 'EURUSD', reason: 'source-disabled' }] }),
    );

    expect(map).toEqual({ EURUSD: 'source-disabled' });
  });

  it('имя вне контракта сохраняется, а не выбрасывается', () => {
    const map = reasonsFromState(
      state({ unavailable: [{ symbol: 'EURUSD', reason: null, rawReason: 'cosmic-rays' }] }),
    );

    expect(map.EURUSD).toBe('cosmic-rays');
  });

  it('«не упомянут» — своя причина, не та же, что «молчит»', () => {
    const map = reasonsFromState(state({ missing: ['XAUUSD'] }));

    expect(map.XAUUSD).toBe('missing');
  });

  it('названная причина важнее отсутствия упоминания', () => {
    const map = reasonsFromState(
      state({ unavailable: [{ symbol: 'EURUSD', reason: 'stale' }], missing: ['EURUSD'] }),
    );

    expect(map.EURUSD).toBe('stale');
  });

  it('у инструмента с ценой причины нет вовсе', () => {
    expect(reasonsFromState(state())).toEqual({});
  });
});

describe('WEB-39 · не спросили — не знаем', () => {
  it.each(['not-configured', 'network', 'http-error', 'malformed'] as const)(
    'отказ «%s» → пусто, а не причина отказа у каждого символа',
    (reason) => {
      expect(unavailableReasonsOf({ state: 'unavailable', reason })).toEqual({});
    },
  );

  it('ответили — причины раскладываются', () => {
    expect(
      unavailableReasonsOf({
        state: 'available',
        quotes: state({ unavailable: [{ symbol: 'EURUSD', reason: 'no-source' }] }),
      }),
    ).toEqual({ EURUSD: 'no-source' });
  });
});

describe('WEB-39 · два перечисления одного множества не разошлись', () => {
  it.each([
    ['только недоступные', state({ unavailable: [{ symbol: 'A', reason: 'stale' }] })],
    ['только неупомянутые', state({ missing: ['B'] })],
    [
      'и те и другие',
      state({ unavailable: [{ symbol: 'A', reason: 'stale' }], missing: ['B', 'A'] }),
    ],
    ['пусто', state()],
  ])('%s', (_name, s) => {
    expect(agreesWithStaleSymbols(s)).toBe(true);
  });

  it('проверка согласия умеет краснеть', () => {
    const s = state({ unavailable: [{ symbol: 'A', reason: 'stale' }] });
    const broken = { ...s, missing: ['Z'] };

    expect(agreesWithStaleSymbols(s)).toBe(true);
    expect(Object.keys(reasonsFromState(broken))).toContain('Z');
  });
});
