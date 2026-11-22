import { afterEach, describe, expect, it, vi } from 'vitest';
import { SITE_URL } from '@/lib/site';

/** ТД-010 · инструменты в sitemap — инструменты сайта из CMS, а не клиентский справочник. */

const cms = vi.hoisted(() => ({ instrumentsFail: false }));

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
  getTenantAccess: async () => ({ state: 'allowed', symbols: new Set(['BTCUSD', 'LTCUSD']) }),
}));
vi.mock('@/lib/mds', () => ({
  getMdsCatalogEntries: async () => ({ state: 'unavailable', reason: 'network' }),
}));
vi.mock('@/lib/site-languages', () => ({
  getSiteLanguages: async () => ({ languages: ['ru', 'en'], defaultLanguage: 'ru' }),
}));

afterEach(() => {
  cms.instrumentsFail = false;
  vi.restoreAllMocks();
});

const instrumentUrls = (entries: { url: string }[]) =>
  entries.map((e) => e.url).filter((u) => u.startsWith(`${SITE_URL}/instruments/`));

describe('ТД-010 · sitemap и инструменты сайта', () => {
  it('ровно инструменты сайта (CMS ∩ доступ), с адресами на всех языках', async () => {
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

  it('CMS недоступна → карта отдаётся без инструментов, а не падает', async () => {
    cms.instrumentsFail = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { default: sitemap } = await import('../../app/sitemap');
    const entries = await sitemap();

    expect(instrumentUrls(entries)).toEqual([]);
    expect(entries.some((e) => e.url === `${SITE_URL}/instruments`)).toBe(true);
  });
});
