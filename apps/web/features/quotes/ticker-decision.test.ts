import { describe, expect, it } from 'vitest';
import {
  decideTicker,
  NO_OVERLAP_REASON,
  type TickerAccess,
  type TickerCatalog,
} from './ticker-decision';

const ALLOWED = (symbols: string[]): TickerAccess => ({ state: 'allowed', symbols });
const STREAMING = (symbols: string[]): TickerCatalog => ({ state: 'available', symbols });

describe('decideTicker · каталога нет — строки нет', () => {
  it.each([
    ['not-configured', 'MDS_HTTP_URL не задан в окружении отвечающего процесса'],
    ['unreachable', 'адрес есть, MDS молчит'],
    ['empty', 'MDS ответил, но не транслирует ничего'],
  ])('каталог %s → отказ, а не зашитый список', (reason) => {
    const decision = decideTicker(
      ['EURUSD', 'BTCUSD', 'XAUUSD'],
      ALLOWED(['EURUSD', 'BTCUSD', 'XAUUSD']),
      { state: 'unavailable', reason, symbols: [] },
    );

    expect(decision).toEqual({
      kind: 'notice',
      state: 'unavailable',
      reason: `quotes:${reason}`,
    });
  });

  it('причина каталога отличима от причины границы доступа машиной', () => {
    const fromCms = decideTicker([], { state: 'unavailable', reason: 'not-configured', symbols: [] }, STREAMING(['EURUSD']));
    const fromMds = decideTicker(['EURUSD'], ALLOWED(['EURUSD']), {
      state: 'unavailable',
      reason: 'not-configured',
      symbols: [],
    });

    expect(fromCms).toMatchObject({ reason: 'not-configured' });
    expect(fromMds).toMatchObject({ reason: 'quotes:not-configured' });
    expect(fromCms).not.toEqual(fromMds);
  });

  it('граница доступа отвечает первой: каталог её не открывает и не объясняет', () => {
    const decision = decideTicker(
      ['EURUSD'],
      { state: 'empty', symbols: [] },
      STREAMING(['EURUSD', 'BTCUSD']),
    );

    expect(decision).toMatchObject({ kind: 'notice', state: 'empty' });
  });

  it('у состояния «пусто» причины НЕТ, и выдумывать её нельзя (WEB-26)', () => {
    const decision = decideTicker(['EURUSD'], { state: 'empty', symbols: [] }, STREAMING(['EURUSD']));

    expect(decision.kind).toBe('notice');
    expect(decision.kind === 'notice' && decision.reason).toBeUndefined();
  });

  it('у недоступности причина ЕСТЬ и доезжает как есть', () => {
    const decision = decideTicker(
      ['EURUSD'],
      { state: 'unavailable', reason: 'expired', symbols: [] },
      STREAMING(['EURUSD']),
    );

    expect(decision).toMatchObject({ kind: 'notice', state: 'unavailable', reason: 'expired' });
  });

  it('причина каталога без значения не превращается в голый префикс', () => {
    const decision = decideTicker(
      ['EURUSD'],
      { state: 'allowed', symbols: ['EURUSD'] },
      { state: 'unavailable', symbols: [] },
    );

    expect(decision.kind === 'notice' && decision.reason).toBeUndefined();
  });
});

describe('decideTicker · пересечение, а не замена', () => {
  it('в строку попадает только то, что разрешено И транслируется И есть на витрине', () => {
    const decision = decideTicker(
      ['EURUSD', 'BTCUSD', 'AAPL'],
      ALLOWED(['EURUSD', 'BTCUSD', 'TSLA']),
      STREAMING(['EURUSD', 'AAPL', 'TSLA']),
    );

    expect(decision).toEqual({ kind: 'ticker', symbols: ['EURUSD'] });
  });

  it('символ, которого нет в каталоге, не проходит даже будучи разрешённым', () => {
    const decision = decideTicker(['EURUSD', 'BTCUSD'], ALLOWED(['EURUSD', 'BTCUSD']), STREAMING(['EURUSD']));

    expect(decision).toEqual({ kind: 'ticker', symbols: ['EURUSD'] });
  });

  it('оба ответа есть, пересечение пусто → отдельное состояние, а не исчезнувшая строка', () => {
    const decision = decideTicker(['AAPL'], ALLOWED(['EURUSD']), STREAMING(['EURUSD']));

    expect(decision).toEqual({ kind: 'notice', state: 'empty', reason: NO_OVERLAP_REASON });
    expect(decision).not.toMatchObject({ kind: 'ticker' });
  });

  it('пустое пересечение отличимо от пустого allow-list', () => {
    const noSelection = decideTicker(['AAPL'], { state: 'empty', symbols: [] }, STREAMING(['AAPL']));
    const noOverlap = decideTicker(['AAPL'], ALLOWED(['EURUSD']), STREAMING(['EURUSD']));

    expect(noSelection.kind === 'notice' && noSelection.reason).not.toBe(
      noOverlap.kind === 'notice' && noOverlap.reason,
    );
  });
});
