import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchLiveSnapshot, parsePlatformTerms } from './platform-terms';

const PORTFOLIO = {
  key: 'pro',
  title: 'Pro',
  baseLeverage: 50,
  classOverrides: { crypto: 20, junk: 'x' },
  markupBps: 5,
  commissionBps: 4,
  isDefault: false,
  isPublic: true,
  sortOrder: 1,
  instruments: 'Крипто',
  description: null,
};

const BODY = {
  attributionWindowDays: 30,
  live: {
    money: { minDepositMinor: 1000, minWithdrawMinor: 1000, unverifiedWithdrawBps: 500 },
    portfolios: [PORTFOLIO, { ...PORTFOLIO, key: 'bad', baseLeverage: 0 }, null],
    support: { alwaysOpen: true, timezone: 'UTC', week: {} },
    promo: { enabled: true, attributionWindowDays: 30 },
    promotions: [],
  },
};

describe('разбор настроек платформы', () => {
  it('целый портфель — как есть; мусор в планках и битые записи отброшены', () => {
    const s = parsePlatformTerms(BODY);
    expect(s?.portfolios).toHaveLength(1);
    expect(s?.portfolios?.[0]).toMatchObject({ key: 'pro', baseLeverage: 50, classOverrides: { crypto: 20 } });
    expect(s?.money?.minDepositMinor).toBe(1000);
  });
  it('ответ без снимка — null (недоступно)', () => {
    expect(parsePlatformTerms({ error: 'unavailable' })).toBeNull();
    expect(parsePlatformTerms(null)).toBeNull();
  });
  it('битый раздел теряет себя, а не весь снимок', () => {
    const s = parsePlatformTerms({ live: { ...BODY.live, money: { minDepositMinor: 'x' } } });
    expect(s?.money).toBeNull();
    expect(s?.portfolios).toHaveLength(1);
  });
});

describe('загрузка с кабинета', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('кабинет 503 / сеть / адрес не задан — null', async () => {
    vi.stubEnv('CABINET_INTERNAL_URL', 'http://cab.test');
    expect(await fetchLiveSnapshot(async () => new Response('{}', { status: 503 }))).toBeNull();
    expect(
      await fetchLiveSnapshot(async () => {
        throw new Error('down');
      }),
    ).toBeNull();
    vi.stubEnv('CABINET_INTERNAL_URL', '');
    vi.stubEnv('NEXT_PUBLIC_CABINET_URL', '');
    expect(await fetchLiveSnapshot(async () => new Response(JSON.stringify(BODY)))).toBeNull();
  });
  it('успех — снимок из ответа', async () => {
    vi.stubEnv('CABINET_INTERNAL_URL', 'http://cab.test/');
    let url = '';
    const out = await fetchLiveSnapshot(async (u) => {
      url = String(u);
      return new Response(JSON.stringify(BODY));
    });
    expect(url).toBe('http://cab.test/api/public/platform-terms');
    expect(out?.portfolios?.[0]?.title).toBe('Pro');
  });
});

describe('страница /accounts без захардкоженных тарифов', () => {
  it('не импортирует старые планы/калькулятор и не содержит чисел тарифа', () => {
    const src = readFileSync(path.resolve(__dirname, '../app/[locale]/(marketing)/accounts/page.tsx'), 'utf8');
    expect(src).not.toMatch(/features\/accounts|CommissionCalculator/);
    const code = src
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n');
    expect(code).not.toMatch(/1:\d{2,}|\$\s?\d|\d+\s?(USDT|USD|пункт|pips)/);
  });
  it('словари страницы — без чисел тарифа (они приходят параметрами)', () => {
    for (const l of ['ru', 'en', 'de', 'fr', 'es']) {
      const m = JSON.parse(readFileSync(path.resolve(__dirname, `../messages/${l}.json`), 'utf8'));
      const text = JSON.stringify(m.accounts).replace(/\{[^{}]*\}/g, '');
      expect(text).not.toMatch(/1:\d|\$\s?\d|\d+\s?%|\d+\.\d+ пункт|\d+ USDT/);
    }
  });
});
