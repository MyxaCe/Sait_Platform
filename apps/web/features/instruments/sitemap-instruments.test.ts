import { afterEach, describe, expect, it, vi } from 'vitest';
import { SITE_URL } from '@/lib/site';

const cms = vi.hoisted(() => ({ instrumentsFail: false, catalog: { state: 'unavailable', reason: 'network' } as unknown }));

vi.mock('@/lib/cms', () => ({
  getCms: async (resource: string) => {
    if (resource === 'instruments') {
      if (cms.instrumentsFail) throw new Error('CMS недоступна, сохранённой версии нет: instruments');
      return {
        items: [
          { symbol: 'BTCUSD', name: 'Bitcoin', category: 'crypto', swapFree: false, icon: null },
          { symbol: 'LTCUSD', name: 'Litecoin', category: 'crypto', swapFree: false, icon: null },
          { symbol: 'NOTALLOWED', name: 'X', category: 'crypto', swapFree: false, icon: null },
        ],
      };
    }
    if (resource === 'articles') return { items: [] };
    if (resource === 'academy') return { articles: [] };
    return { items: [] };
  },
}));
vi.mock('@/lib/tenant', () => ({
  getTenantAccess: async () => ({ state: 'allowed', symbols: new Set(['BTCUSD', 'LTCUSD', 'TRXUSD']) }),
}));
vi.mock('@/lib/mds', () => ({
  getMdsCatalogEntries: async () => cms.catalog,
}));
vi.mock('@/lib/site-languages', () => ({
  getSiteLanguages: async () => ({ languages: ['ru', 'en'], defaultLanguage: 'ru' }),
}));

afterEach(() => {
  cms.instrumentsFail = false;
  cms.catalog = { state: 'unavailable', reason: 'network' };
  vi.restoreAllMocks();
});

const instrumentUrls = (entries: { url: string }[]) =>
  entries.map((e) => e.url).filter((u) => u.startsWith(`${SITE_URL}/instruments/`));

describe('ТД-010 · sitemap и инструменты сайта', () => {
  it('каталог MDS недоступен → только инструменты с записью CMS, с адресами на всех языках', async () => {
    const { default: sitemap } = await import('../../app/sitemap');
    const entries = await sitemap();

    expect(instrumentUrls(entries)).toEqual([
      `${SITE_URL}/instruments/crypto/btcusd`,
      `${SITE_URL}/instruments/crypto/ltcusd`,
    ]);
    const btc = entries.find((e) => e.url === `${SITE_URL}/instruments/crypto/btcusd`);
    expect(btc?.alternates?.languages).toEqual({
      ru: `${SITE_URL}/instruments/crypto/btcusd`,
      en: `${SITE_URL}/en/instruments/crypto/btcusd`,
    });
  });

  it('инструмент из карточки сайта без записи CMS — в карте по каталогу MDS', async () => {
    const entry = (symbol: string) => ({ symbol, name: symbol, category: 'crypto', digits: 2, minQty: null });
    cms.catalog = { state: 'available', entries: { BTCUSD: entry('BTCUSD'), LTCUSD: entry('LTCUSD'), TRXUSD: entry('TRXUSD') } };
    const { default: sitemap } = await import('../../app/sitemap');

    expect(instrumentUrls(await sitemap())).toEqual([
      `${SITE_URL}/instruments/crypto/btcusd`,
      `${SITE_URL}/instruments/crypto/ltcusd`,
      `${SITE_URL}/instruments/crypto/trxusd`,
    ]);
  });

  it('CMS недоступна → карта отдаётся без инструментов, а не падает', async () => {
    cms.instrumentsFail = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { default: sitemap } = await import('../../app/sitemap');
    const entries = await sitemap();

    expect(instrumentUrls(entries)).toEqual([]);
    expect(entries.some((e) => e.url === `${SITE_URL}/instruments`)).toBe(true);
  });
});
