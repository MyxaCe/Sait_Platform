import { describe, expect, it } from 'vitest';
import { DEPOSIT_METHODS } from './deposit-methods';
import { LIVE_PARAMS, MISSING_VALUE, resolveParam, sourcesOf, type ParamContext } from './params';
import type { LiveSnapshot } from './snapshot';

const snapshot: LiveSnapshot = {
  money: { minDepositMinor: 1000, minWithdrawMinor: 2550, unverifiedWithdrawBps: 500 },
  portfolios: [
    {
      key: 'pro',
      title: 'Pro',
      baseLeverage: 50,
      classOverrides: {},
      markupBps: 15,
      commissionBps: 0,
      isDefault: false,
      isPublic: true,
      sortOrder: 20,
      instruments: null,
      description: null,
    },
    {
      key: 'standard',
      title: 'Standard',
      baseLeverage: 20,
      classOverrides: { crypto: 10, forex: 200 },
      markupBps: 0,
      commissionBps: 10,
      isDefault: true,
      isPublic: true,
      sortOrder: 10,
      instruments: null,
      description: null,
    },
    {
      key: 'enc_prime',
      title: 'ECN Prime',
      baseLeverage: 100,
      classOverrides: {},
      markupBps: 0,
      commissionBps: 5,
      isDefault: false,
      isPublic: true,
      sortOrder: 30,
      instruments: null,
      description: null,
    },
    {
      key: 'vip',
      title: 'VIP',
      baseLeverage: 500,
      classOverrides: {},
      markupBps: 0,
      commissionBps: 0,
      isDefault: false,
      isPublic: false,
      sortOrder: 40,
      instruments: null,
      description: null,
    },
  ],
  support: { alwaysOpen: true, timezone: 'Europe/Moscow', week: {} },
  promo: null,
  promotions: null,
};

const ALWAYS_OPEN: Record<string, string> = {
  ru: 'круглосуточно',
  en: '24/7',
  de: 'rund um die Uhr',
  fr: '24 h/24, 7 j/7',
  es: 'las 24 horas',
};

const ctx = (locale: string, over: Partial<ParamContext> = {}): ParamContext => ({
  locale,
  snapshot,
  startBalanceCents: 1_000_000,
  labels: { supportAlwaysOpen: ALWAYS_OPEN[locale]! },
  ...over,
});

const plain = (s: string) => s.replace(/[  ]/g, ' ');

function value(name: string, c: ParamContext): string {
  const r = resolveParam(name, c);
  if (!r.ok) throw new Error(`${name}: ${r.reason}`);
  return plain(r.value);
}

const EXPECTED: Record<string, Record<string, string>> = {
  'deposit.min': { ru: '10 USDT', en: '10 USDT', de: '10 USDT', fr: '10 USDT', es: '10 USDT' },
  'withdraw.min': { ru: '25,5 USDT', en: '25.5 USDT', de: '25,5 USDT', fr: '25,5 USDT', es: '25,5 USDT' },
  'withdraw.unverifiedPercent': { ru: '5 %', en: '5%', de: '5 %', fr: '5 %', es: '5 %' },
  'deposit.methods': { ru: 'USDT (TRC20)', en: 'USDT (TRC20)', de: 'USDT (TRC20)', fr: 'USDT (TRC20)', es: 'USDT (TRC20)' },
  'demo.startBalance': { ru: '10 000 USD', en: '10,000 USD', de: '10.000 USD', fr: '10 000 USD', es: '10.000 USD' },
  'leverage.max': { ru: '1:100', en: '1:100', de: '1:100', fr: '1:100', es: '1:100' },
  'leverage.forex': { ru: '1:200', en: '1:200', de: '1:200', fr: '1:200', es: '1:200' },
  'leverage.metals': { ru: '1:100', en: '1:100', de: '1:100', fr: '1:100', es: '1:100' },
  'account.standard.name': { ru: 'Standard', en: 'Standard', de: 'Standard', fr: 'Standard', es: 'Standard' },
  'account.enc_prime.name': { ru: 'ECN Prime', en: 'ECN Prime', de: 'ECN Prime', fr: 'ECN Prime', es: 'ECN Prime' },
  'account.standard.leverage': { ru: '1:20', en: '1:20', de: '1:20', fr: '1:20', es: '1:20' },
  'account.pro.leverage': { ru: '1:50', en: '1:50', de: '1:50', fr: '1:50', es: '1:50' },
  'account.standard.leverage.crypto': { ru: '1:10', en: '1:10', de: '1:10', fr: '1:10', es: '1:10' },
  'account.pro.leverage.crypto': { ru: '1:50', en: '1:50', de: '1:50', fr: '1:50', es: '1:50' },
  'account.standard.commission': { ru: '0,1 %', en: '0.1%', de: '0,1 %', fr: '0,1 %', es: '0,1 %' },
  'account.pro.markup': { ru: '0,15 %', en: '0.15%', de: '0,15 %', fr: '0,15 %', es: '0,15 %' },
  'account.enc_prime.markup': { ru: '0 %', en: '0%', de: '0 %', fr: '0 %', es: '0 %' },
  'support.hours': ALWAYS_OPEN,
};

describe('параметры на пяти языках', () => {
  for (const [name, byLocale] of Object.entries(EXPECTED)) {
    for (const [locale, expected] of Object.entries(byLocale)) {
      it(`${name} · ${locale} → ${expected}`, () => {
        expect(value(name, ctx(locale))).toBe(expected);
      });
    }
  }

  it('каждый шаблон из списка покрыт проверкой', () => {
    const covered = Object.keys(EXPECTED).map((n) =>
      n.startsWith('account.')
        ? n.replace(/^account\.[a-z_]+/, 'account.<key>').replace(/\.crypto$/, '.<class>')
        : n.replace(/^leverage\.(?!max$)[a-z]+$/, 'leverage.<class>'),
    );
    for (const template of LIVE_PARAMS) expect(covered).toContain(template);
  });

  it('пробел в числе и перед знаком процента неразрывный', () => {
    const r = resolveParam('demo.startBalance', ctx('ru'));
    expect(r.ok && /\s/.test(r.value.replace(/[  ]/g, ''))).toBe(false);
    const p = resolveParam('withdraw.unverifiedPercent', ctx('fr'));
    expect(p.ok && p.value.includes(' ')).toBe(false);
  });

  it('способ пополнения — из единого перечня пакета', () => {
    expect(DEPOSIT_METHODS).toEqual([{ asset: 'USDT', network: 'TRC20' }]);
  });
});

describe('расписание поддержки', () => {
  const week = {
    mon: { open: '09:00', close: '21:00' },
    tue: { open: '09:00', close: '21:00' },
    wed: { open: '09:00', close: '21:00' },
    thu: { open: '09:00', close: '21:00' },
    fri: { open: '09:00', close: '21:00' },
    sat: { open: '10:00', close: '16:00' },
  };
  const scheduled: LiveSnapshot = { ...snapshot, support: { alwaysOpen: false, timezone: 'Europe/Moscow', week } };

  it('ru: дни группируются, часовой пояс указан', () => {
    expect(value('support.hours', ctx('ru', { snapshot: scheduled }))).toBe('пн–пт 09:00–21:00, сб 10:00–16:00 (Europe/Moscow)');
  });

  for (const locale of ['en', 'de', 'fr', 'es']) {
    it(`${locale}: названия дней — по языку страницы`, () => {
      const day = (d: number) =>
        new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1 + d)));
      expect(value('support.hours', ctx(locale, { snapshot: scheduled }))).toBe(
        `${day(0)}–${day(4)} 09:00–21:00, ${day(5)} 10:00–16:00 (Europe/Moscow)`,
      );
    });
  }

  it('круглосуточно без подписи из словаря — недоступно, а не выдумано', () => {
    expect(resolveParam('support.hours', ctx('de', { labels: null }))).toEqual({ ok: false, reason: 'unavailable' });
  });
});

describe('неизвестное и недоступное', () => {
  it.each([
    'deposit.max',
    'account.vip.name',
    'account.nope.leverage',
    'account.standard.commission.crypto',
    'account.standard.spread',
    'leverage',
    'leverage.fx',
    'leverage.forex.max',
  ])('%s — неизвестный параметр', (name) => {
    expect(resolveParam(name, ctx('ru'))).toEqual({ ok: false, reason: 'unknown' });
  });

  it.each([
    'deposit.min',
    'withdraw.min',
    'withdraw.unverifiedPercent',
    'leverage.max',
    'leverage.forex',
    'account.standard.name',
    'account.standard.leverage.crypto',
    'support.hours',
  ])('%s без настроек — недоступен', (name) => {
    expect(resolveParam(name, ctx('ru', { snapshot: null }))).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('стартовый демо-баланс не назначен — недоступен', () => {
    expect(resolveParam('demo.startBalance', ctx('ru', { startBalanceCents: null }))).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('нет публичных портфелей — максимум плеча недоступен', () => {
    expect(resolveParam('leverage.max', ctx('ru', { snapshot: { ...snapshot, portfolios: [] } }))).toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });

  it('способ пополнения не зависит от базы', () => {
    expect(resolveParam('deposit.methods', ctx('ru', { snapshot: null }))).toEqual({ ok: true, value: 'USDT (TRC20)' });
  });

  it('заглушка — тире', () => {
    expect(MISSING_VALUE).toBe('—');
  });

  it('источники параметров', () => {
    expect(sourcesOf('demo.startBalance')).toEqual(['startBalance']);
    expect(sourcesOf('support.hours')).toEqual(['snapshot', 'labels']);
    expect(sourcesOf('deposit.methods')).toEqual([]);
    expect(sourcesOf('whatever')).toBeNull();
  });
});
