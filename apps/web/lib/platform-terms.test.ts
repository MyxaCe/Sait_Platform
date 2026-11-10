import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bpsPercent, fetchAccountTypes, parseAccountType, parseAccountTypes } from './platform-terms';

/**
 * `/accounts` — условия типов счетов только из админки (решение владельца
 * №9) через ручку кабинета. Потребитель парсит мягко; нет данных — `null`
 * (страница говорит «временно недоступны»), а не выдуманные цифры.
 */

const GOOD = {
  key: 'pro',
  title: 'Pro',
  isDefault: false,
  sortOrder: 1,
  leverage: 50,
  baseLeverage: 50,
  classOverrides: { crypto: 20, junk: 'x' },
  markupBps: 5,
  commissionBps: 4,
  instruments: 'Крипто',
  description: null,
};

describe('разбор условий счетов', () => {
  it('целая запись — как есть; мусор в планках отброшен', () => {
    expect(parseAccountType(GOOD)).toMatchObject({ key: 'pro', leverage: 50, classOverrides: { crypto: 20 }, instruments: 'Крипто' });
  });
  it('нет плеча/тарифа — запись отброшена (не «нулями»), остальные остаются', () => {
    const { markupBps: _m, ...noMarkup } = GOOD;
    expect(parseAccountType(noMarkup)).toBeNull();
    expect(parseAccountTypes({ accountTypes: [GOOD, { ...GOOD, leverage: 0 }, null] })).toHaveLength(1);
  });
  it('ответ без списка — null (недоступно), пустой список — []', () => {
    expect(parseAccountTypes({ error: 'unavailable' })).toBeNull();
    expect(parseAccountTypes({ accountTypes: [] })).toEqual([]);
  });
  it('проценты из б.п.', () => {
    expect(bpsPercent(15, 'ru')).toBe('0,15 %');
    expect(bpsPercent(3, 'en')).toBe('0.03%');
  });
});

describe('загрузка с кабинета', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('кабинет 503 / сеть / адрес не задан — null', async () => {
    vi.stubEnv('CABINET_INTERNAL_URL', 'http://cab.test');
    expect(await fetchAccountTypes(async () => new Response('{}', { status: 503 }))).toBeNull();
    expect(
      await fetchAccountTypes(async () => {
        throw new Error('down');
      }),
    ).toBeNull();
    vi.stubEnv('CABINET_INTERNAL_URL', '');
    vi.stubEnv('NEXT_PUBLIC_CABINET_URL', '');
    expect(await fetchAccountTypes(async () => new Response(JSON.stringify({ accountTypes: [GOOD] })))).toBeNull();
  });
  it('успех — список из ответа', async () => {
    vi.stubEnv('CABINET_INTERNAL_URL', 'http://cab.test/');
    let url = '';
    const out = await fetchAccountTypes(async (u) => {
      url = String(u);
      return new Response(JSON.stringify({ accountTypes: [GOOD] }));
    });
    expect(url).toBe('http://cab.test/api/public/platform-terms');
    expect(out?.[0]?.title).toBe('Pro');
  });
});

describe('страница /accounts без захардкоженных тарифов', () => {
  it('не импортирует старые планы/калькулятор и не содержит чисел тарифа', () => {
    const src = readFileSync(path.resolve(__dirname, '../app/[locale]/(marketing)/accounts/page.tsx'), 'utf8');
    expect(src).not.toMatch(/features\/accounts|CommissionCalculator|getCms\('accounts'/);
    const code = src
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n');
    expect(code).not.toMatch(/1:\d{2,}|\$\s?\d|\d+\s?(USDT|USD|пункт|pips)/);
  });
  it('словари страницы — без чисел тарифа (они приходят параметрами)', () => {
    for (const l of ['ru', 'en']) {
      const m = JSON.parse(readFileSync(path.resolve(__dirname, `../messages/${l}.json`), 'utf8'));
      const text = JSON.stringify(m.accounts).replace(/\{[^{}]*\}/g, '');
      expect(text).not.toMatch(/1:\d|\$\s?\d|\d+\s?%|\d+\.\d+ пункт|\d+ USDT/);
    }
  });
});
