import { afterEach, describe, expect, it, vi } from 'vitest';
import { catalogEntryOf } from './mds';

describe('каталог MDS · запись инструмента', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('v1: имя, категория, точность', () => {
    expect(catalogEntryOf({ symbol: 'BTCUSD', name: 'Bitcoin', category: 'crypto', digits: 2 })).toEqual({
      symbol: 'BTCUSD',
      name: 'Bitcoin',
      category: 'crypto',
      digits: 2,
      minQty: null,
    });
  });

  it('v2: priceDecimals и minQty', () => {
    expect(catalogEntryOf({ symbol: 'EURUSD', name: 'Euro / US Dollar', category: 'forex', priceDecimals: 5, minQty: '0.01' })).toMatchObject({
      digits: 5,
      minQty: '0.01',
    });
  });

  it('незнакомая категория и негодная точность — неизвестны, а не угаданы', () => {
    expect(catalogEntryOf({ symbol: 'X', category: 'bonds', digits: -1, name: '' })).toEqual({
      symbol: 'X',
      name: null,
      category: null,
      digits: null,
      minQty: null,
    });
  });

  it('без символа записи нет', () => {
    expect(catalogEntryOf({ name: 'Bitcoin' })).toBeNull();
  });

  it('getMdsCatalogEntries собирает записи по символу', async () => {
    vi.stubEnv('MDS_HTTP_URL', 'http://mds.test');
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ items: [{ symbol: 'LTCUSD', name: 'Litecoin', category: 'crypto', digits: 2 }, { name: 'x' }] })),
        ),
      ),
    );
    const { getMdsCatalogEntries } = await import('./mds');

    const got = await getMdsCatalogEntries();
    expect(got.state).toBe('available');
    if (got.state === 'available') expect(Object.keys(got.entries)).toEqual(['LTCUSD']);
  });

  it('MDS не ответил → причина, а не пустой каталог', async () => {
    vi.stubEnv('MDS_HTTP_URL', 'http://mds.test');
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))));
    const { getMdsCatalogEntries } = await import('./mds');

    expect(await getMdsCatalogEntries()).toEqual({ state: 'unavailable', reason: 'network' });
  });
});
