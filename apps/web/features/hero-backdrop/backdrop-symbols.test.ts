import { describe, expect, it } from 'vitest';
import type { TickerAccess, TickerCatalog } from '@/features/quotes/ticker-decision';
import { MAX_BACKDROP_SYMBOLS, pickBackdropSymbols } from './backdrop-symbols';

const ALLOWED = (symbols: string[]): TickerAccess => ({ state: 'allowed', symbols });
const STREAMING = (symbols: string[]): TickerCatalog => ({ state: 'available', symbols });

describe('символы фона — те же, что у бегущей строки', () => {
  it('пересечение CMS ∩ allow-list ∩ MDS в порядке CMS', () => {
    expect(
      pickBackdropSymbols(
        ['XAUUSD', 'BTCUSD', 'ETHUSD', 'EURUSD'],
        ALLOWED(['BTCUSD', 'ETHUSD', 'XAUUSD']),
        STREAMING(['ETHUSD', 'BTCUSD']),
      ),
    ).toEqual(['BTCUSD', 'ETHUSD']);
  });

  it(`не больше ${MAX_BACKDROP_SYMBOLS}`, () => {
    const all = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    expect(pickBackdropSymbols(all, ALLOWED(all), STREAMING(all))).toHaveLength(
      MAX_BACKDROP_SYMBOLS,
    );
  });

  it.each<[string, TickerAccess, TickerCatalog]>([
    ['граница доступа закрыта', { state: 'unavailable', symbols: [] }, STREAMING(['BTCUSD'])],
    ['allow-list пуст', { state: 'empty', symbols: [] }, STREAMING(['BTCUSD'])],
    [
      'каталога MDS нет',
      ALLOWED(['BTCUSD']),
      { state: 'unavailable', reason: 'not-configured', symbols: [] },
    ],
    ['пересечение пусто', ALLOWED(['BTCUSD']), STREAMING(['ETHUSD'])],
  ])('%s — символов нет, линий нет', (_name, access, catalog) => {
    expect(pickBackdropSymbols(['BTCUSD'], access, catalog)).toEqual([]);
  });
});
