import { describe, expect, it } from 'vitest';
import { computeLinkSignals, normalizeEmail, isMeaningfulIp } from './antifraud';
import { cookiesForClick, decodeClick, encodeClick, resolveAttribution } from './attribution';
import { maskName, rankContest, type ContestEntryFacts } from './contest';
import { platformAllowsPromotions, promoAvailability, type PlatformPromoSettings } from './eligibility';
import {
  computeCashback,
  evaluateDepositBonus,
  evaluatePromotion,
  evaluateReferee,
  periodBounds,
  periodOf,
  platformRevenueMinor,
  revshareMinor,
} from './evaluate';
import type { ClientFacts, TradeFact } from './facts';
import { parseRules, type ContestRules, type DepositBonusRules, type ReferralRules } from './rules';
import { computeTurnover } from './turnover';
import { rewardRef } from './refs';

/**
 * Движок акций — чистые функции: все условия, границы, кешбэк, конкурс,
 * антифрод, атрибуция. Числа правил — из «админки» (здесь — из фикстуры
 * решения владельца 10.11), в коде движка их нет.
 */

const T0 = '2026-11-01T00:00:00.000Z';
const at = (min: number) => new Date(Date.parse(T0) + min * 60_000).toISOString();
const day = (d: number) => new Date(Date.parse(T0) + d * 86_400_000).toISOString();

// Решение владельца №2 (в админке это строка `promotions.rules`).
const BONUS: DepositBonusRules = {
  percentBps: 3000,
  capMinor: 30_000,
  minDepositMinor: 50_000,
  firstDepositOnly: true,
  kycRequired: true,
  turnoverMultiplier: 30,
  minHoldSeconds: 120,
  windowDays: 30,
  forfeitOnWithdrawal: true,
};

// Решение владельца №3.
const REFERRAL: ReferralRules = {
  referrerRewardMinor: 2_500,
  refereeRewardMinor: 2_500,
  kycRequired: true,
  minDepositMinor: 10_000,
  turnoverNotionalMinor: 1_000_000,
  minHoldSeconds: 120,
  windowDays: 30,
  maxPaidReferralsPerMonth: 10,
  forfeitOnWithdrawal: true,
};

function facts(over: Partial<ClientFacts> = {}): ClientFacts {
  return {
    userId: 'u1',
    registeredAt: T0,
    kycVerified: true,
    country: 'CY',
    deposits: [],
    trades: [],
    withdrawals: [],
    ...over,
  };
}

/** Пара open/close по BTC с удержанием `holdSec`, нотионал ноги = qty*price. */
function roundTrip(startMin: number, holdSec: number, qty: number, price: number): TradeFact[] {
  const open = new Date(Date.parse(at(startMin)));
  const close = new Date(open.getTime() + holdSec * 1000);
  return [
    { symbol: 'BTCUSDT', side: 'buy', volume: qty, price, executedAt: open.toISOString() },
    { symbol: 'BTCUSDT', side: 'sell', volume: qty, price, executedAt: close.toISOString(), realizedPnlMinor: 0 },
  ];
}

describe('правила — схема одна на запись и чтение', () => {
  it('принимает решение владельца и отвергает мусор', () => {
    expect(parseRules('deposit_bonus', BONUS).ok).toBe(true);
    expect(parseRules('referral', REFERRAL).ok).toBe(true);
    const bad = parseRules('deposit_bonus', { ...BONUS, percentBps: -1 });
    expect(bad.ok).toBe(false);
    expect(parseRules('deposit_bonus', { ...BONUS, extra: 1 }).ok).toBe(false);
    expect(parseRules('nope', {}).ok).toBe(false);
    expect(parseRules('referral', { ...REFERRAL, referrerRewardMinor: 0, refereeRewardMinor: 0 }).ok).toBe(false);
    expect(
      parseRules('contest', {
        startBalanceMinor: 1_000_000,
        minTrades: 5,
        prizes: [
          { place: 1, amountMinor: 100 },
          { place: 1, amountMinor: 50 },
        ],
        prizeRequiresKyc: true,
        disqualifyOnReset: false,
      }).ok,
    ).toBe(false);
  });
});

describe('оборот: нотионал и удержание ≥ N секунд', () => {
  it('N = 0 — нотионал всех сделок', () => {
    const r = computeTurnover(roundTrip(0, 5, 0.1, 50_000), { minHoldSeconds: 0 });
    expect(r.qualifyingMinor).toBe(1_000_000); // 2 ноги × $5 000
  });
  it('удержание ровно N засчитывается, N−1 — нет', () => {
    expect(computeTurnover(roundTrip(0, 120, 0.1, 50_000), { minHoldSeconds: 120 }).qualifyingMinor).toBe(1_000_000);
    const short = computeTurnover(roundTrip(0, 119, 0.1, 50_000), { minHoldSeconds: 120 });
    expect(short.qualifyingMinor).toBe(0);
    expect(short.shortHolds).toBe(1);
    expect(short.grossMinor).toBe(1_000_000);
  });
  it('открытая позиция не засчитывается, пока не закрыта', () => {
    const open = roundTrip(0, 600, 0.1, 50_000).slice(0, 1);
    expect(computeTurnover(open, { minHoldSeconds: 120 }).qualifyingMinor).toBe(0);
  });
  it('FIFO: частичное закрытие и переворот через ноль', () => {
    const tr: TradeFact[] = [
      { symbol: 'X', side: 'buy', volume: 2, price: 100, executedAt: at(0) },
      { symbol: 'X', side: 'buy', volume: 1, price: 100, executedAt: at(9) }, // молодой лот
      { symbol: 'X', side: 'sell', volume: 4, price: 100, executedAt: at(10) }, // закрыл 3, открыл шорт 1
      { symbol: 'X', side: 'buy', volume: 1, price: 100, executedAt: at(20) }, // закрыл шорт (10 мин)
    ];
    const r = computeTurnover(tr, { minHoldSeconds: 120 });
    // лот 2 (10 мин) ✓ → 2×100×2; лот 1 (1 мин) ✗; шорт 1 (10 мин) ✓ → 1×100×2
    expect(r.qualifyingMinor).toBe(60_000);
    expect(r.shortHolds).toBe(1);
  });
  it('окно: сделки вне окна не считаются', () => {
    const r = computeTurnover(roundTrip(0, 300, 0.1, 50_000), { minHoldSeconds: 0, from: at(1) });
    expect(r.qualifyingMinor).toBe(500_000);
  });
});

describe('бонус на первый депозит (30 %, ≤ $300, оборот 30×, 120 с, 30 дней, KYC)', () => {
  const ctx = { enrolledAt: T0, promotionStartsAt: T0 };
  const dep = (amount: number, d = 1) => ({ id: `d${d}`, amountMinor: amount, creditedAt: day(d) });

  it('нет депозита — в процессе, ожидание до потолка', () => {
    const ev = evaluateDepositBonus(BONUS, ctx, facts(), new Date(day(2)));
    expect(ev.state).toBe('in_progress');
    expect(ev.rewardMinor).toBeNull();
    expect(ev.conditions.find((c) => c.key === 'turnover')?.target).toBe(900_000);
  });
  it('депозит $500 ровно — граница минимума принимается; награда 30 % = $150', () => {
    const ev = evaluateDepositBonus(BONUS, ctx, facts({ deposits: [dep(50_000)] }), new Date(day(2)));
    expect(ev.rewardMinor).toBe(15_000);
    expect(ev.conditions.find((c) => c.key === 'deposit')?.met).toBe(true);
    expect(ev.conditions.find((c) => c.key === 'turnover')?.target).toBe(450_000);
  });
  it('первый депозит $499.99 — не подходит (not_eligible), даже если второй больше', () => {
    const ev = evaluateDepositBonus(BONUS, ctx, facts({ deposits: [dep(49_999, 1), dep(100_000, 2)] }), new Date(day(3)));
    expect(ev.state).toBe('not_eligible');
    expect(ev.reason).toBe('below_minimum');
  });
  it('потолок $300 на клиента', () => {
    const ev = evaluateDepositBonus(BONUS, ctx, facts({ deposits: [dep(5_000_000)] }), new Date(day(2)));
    expect(ev.rewardMinor).toBe(30_000);
  });
  it('первый депозит до старта акции — не подходит', () => {
    const ev = evaluateDepositBonus(
      BONUS,
      { enrolledAt: day(5), promotionStartsAt: day(3) },
      facts({ deposits: [dep(100_000, 1)] }),
      new Date(day(6)),
    );
    expect(ev.state).toBe('not_eligible');
    expect(ev.reason).toBe('deposit_before_start');
  });
  it('все условия → qualified; без KYC — нет', () => {
    // награда $150 → оборот $4 500: две пары по $2 500 нотионала на ногу
    const trades = [...roundTrip(60 * 24 * 2, 300, 0.05, 50_000), ...roundTrip(60 * 24 * 3, 300, 0.05, 50_000)];
    const ok = evaluateDepositBonus(BONUS, ctx, facts({ deposits: [dep(50_000)], trades }), new Date(day(4)));
    expect(ok.state).toBe('qualified');
    const noKyc = evaluateDepositBonus(BONUS, ctx, facts({ kycVerified: false, deposits: [dep(50_000)], trades }), new Date(day(4)));
    expect(noKyc.state).toBe('in_progress');
  });
  it('короткие сделки (< 120 с) не делают оборот', () => {
    const trades = Array.from({ length: 20 }, (_, i) => roundTrip(60 * 24 * 2 + i * 10, 30, 0.05, 50_000)).flat();
    const ev = evaluateDepositBonus(BONUS, ctx, facts({ deposits: [dep(50_000)], trades }), new Date(day(4)));
    expect(ev.state).toBe('in_progress');
    expect(ev.turnover?.shortHolds).toBe(20);
  });
  it('вывод до выплаты — expired (withdrawal); отклонённый вывод не считается', () => {
    const w = (status: string) => ({ id: 'w', requestedAt: day(2), status });
    expect(evaluateDepositBonus(BONUS, ctx, facts({ deposits: [dep(50_000)], withdrawals: [w('requested')] }), new Date(day(3))).reason).toBe('withdrawal');
    expect(evaluateDepositBonus(BONUS, ctx, facts({ deposits: [dep(50_000)], withdrawals: [w('rejected')] }), new Date(day(3))).state).toBe('in_progress');
  });
  it('окно: не выполнено к концу 30 дней — expired; сделки после окна не засчитываются', () => {
    const late = roundTrip(60 * 24 * 31, 300, 1, 50_000);
    const ev = evaluateDepositBonus(BONUS, ctx, facts({ deposits: [dep(50_000)], trades: late }), new Date(day(32)));
    expect(ev.state).toBe('expired');
    expect(ev.reason).toBe('window');
  });
  it('выполненное в окне остаётся выполненным, когда бы ни считали', () => {
    const trades = roundTrip(60 * 24 * 2, 300, 0.1, 50_000);
    const ev = evaluateDepositBonus(BONUS, ctx, facts({ deposits: [dep(50_000)], trades }), new Date(day(90)));
    expect(ev.state).toBe('qualified');
  });
  it('evaluatePromotion — тот же итог через диспетчер', () => {
    const p = parseRules('deposit_bonus', BONUS);
    if (!p.ok) throw new Error('rules');
    const ev = evaluatePromotion(p.value, { startsAt: T0, endsAt: null }, { enrolledAt: T0 }, facts({ deposits: [dep(50_000)] }), new Date(day(2)));
    expect(ev && 'state' in ev ? ev.state : null).toBe('in_progress');
  });
});

describe('друг (реферал): KYC + депозит ≥ $100 + оборот $10 000 за 30 дней', () => {
  const ctx = { attributedAt: T0, rewardMinor: 2_500 };
  it('выполнено → qualified; оборот $9 999.98 — нет', () => {
    const dep = [{ id: 'd', amountMinor: 10_000, creditedAt: day(1) }];
    const enough = roundTrip(60 * 24 * 2, 300, 0.1, 50_000); // 2 × $5 000 = $10 000
    expect(evaluateReferee(REFERRAL, ctx, facts({ deposits: dep, trades: enough }), new Date(day(3))).state).toBe('qualified');
    const short = roundTrip(60 * 24 * 2, 300, 0.1, 49_999.9);
    expect(evaluateReferee(REFERRAL, ctx, facts({ deposits: dep, trades: short }), new Date(day(3))).state).toBe('in_progress');
  });
});

describe('кешбэк: % от уплаченных наценки и комиссии за месяц', () => {
  const rules = { percentBps: 1500, minPayoutMinor: 100, capPerPeriodMinor: 0, kycRequired: false };
  const t = (iso: string, commission: number | null, markup: number | null) => ({ executedAt: iso, commissionMinor: commission, markupMinor: markup });

  it('без полей комиссии (старый терминал) — 0, не догадка', () => {
    const r = computeCashback(rules, [t('2026-10-05T00:00:00Z', null, null), t('2026-10-06T00:00:00Z', null, null)], '2026-10');
    expect(r.cashbackMinor).toBe(0);
    expect(r.feesMinor).toBe(0);
    expect(r.tradesWithoutFees).toBe(2);
  });
  it('15 % от (комиссия + наценка); вне месяца не считается; ниже минимума — 0; потолок', () => {
    const trades = [t('2026-10-01T00:00:00Z', 1_000, 2_000), t('2026-10-31T23:59:59Z', 500, null), t('2026-11-01T00:00:00Z', 9_999, 9_999)];
    expect(computeCashback(rules, trades, '2026-10').cashbackMinor).toBe(525);
    expect(computeCashback({ ...rules, minPayoutMinor: 600 }, trades, '2026-10').cashbackMinor).toBe(0);
    expect(computeCashback({ ...rules, capPerPeriodMinor: 300 }, trades, '2026-10').cashbackMinor).toBe(300);
  });
  it('период: границы месяца UTC', () => {
    expect(periodOf('2026-12-31T23:59:59Z')).toBe('2026-12');
    expect(periodBounds('2026-02')).toEqual({ from: '2026-02-01T00:00:00.000Z', until: '2026-02-28T23:59:59.999Z' });
  });
  it('IB revshare: доля дохода платформы, без полей — 0', () => {
    const rev = platformRevenueMinor([t('2026-10-02T00:00:00Z', 1_000, 3_000), t('2026-10-03T00:00:00Z', null, null)], '2026-10');
    expect(rev).toBe(4_000);
    expect(revshareMinor(rev, 2500)).toBe(1_000);
    expect(revshareMinor(-5, 2500)).toBe(0);
  });
});

describe('конкурс: ранжирование по доходности, мин. сделок', () => {
  const rules: ContestRules = {
    startBalanceMinor: 1_000_000,
    minTrades: 3,
    prizes: [
      { place: 1, amountMinor: 50_000 },
      { place: 2, amountMinor: 20_000 },
    ],
    prizeRequiresKyc: true,
    disqualifyOnReset: false,
  };
  const e = (id: string, pnl: number, trades: number, over: Partial<ContestEntryFacts> = {}): ContestEntryFacts => ({
    userId: id,
    displayName: `Иван ${id}`,
    status: 'active',
    joinedAt: at(Number(id.replace(/\D/g, '')) || 0),
    baselineMinor: 1_000_000,
    tradesCount: trades,
    pnlMinor: pnl,
    kycVerified: true,
    ...over,
  });

  it('места по доходности; меньше мин. сделок — без места; призы по местам', () => {
    const s = rankContest(rules, [e('u1', 50_000, 5), e('u2', 120_000, 3), e('u3', 900_000, 2), e('u4', -10_000, 9)]);
    expect(s.map((x) => [x.userId, x.place])).toEqual([
      ['u2', 1],
      ['u1', 2],
      ['u4', 3],
      ['u3', null],
    ]);
    expect(s[0]!.returnBps).toBe(1200);
    expect(s[0]!.prizeMinor).toBe(50_000);
    expect(s[2]!.prizeMinor).toBeNull();
    expect(s[3]!.ineligible).toBe('min_trades');
  });
  it('ничья: больше сделок выше, затем раньше вступил', () => {
    const s = rankContest(rules, [e('u1', 10_000, 3), e('u2', 10_000, 4), e('u3', 10_000, 4, { joinedAt: at(-5) })]);
    expect(s.map((x) => x.userId)).toEqual(['u3', 'u2', 'u1']);
  });
  it('без базы (ждёт сброса) и дисквалифицированные — без места; приз без KYC помечен', () => {
    const s = rankContest(rules, [e('u1', 1, 3, { status: 'pending_reset', baselineMinor: null }), e('u2', 5, 3, { kycVerified: false }), e('u3', 1, 3, { status: 'disqualified' })]);
    expect(s[0]!.userId).toBe('u2');
    expect(s[0]!.prizeBlockedByKyc).toBe(true);
    expect(s.filter((x) => x.place === null).map((x) => x.ineligible).sort()).toEqual(['disqualified', 'pending_reset']);
  });
  it('маска имени', () => {
    expect(maskName('Алексей Морозов')).toBe('Алексей М.');
    expect(maskName('Cher')).toBe('Cher');
  });
});

describe('антифрод: сигналы связанности', () => {
  const fp = (userId: string, o: Partial<{ w: string[]; a: string[]; ip: string[]; email: string }> = {}) => ({
    userId,
    email: o.email ?? `${userId}@x.io`,
    depositWallets: o.w ?? [],
    withdrawAddresses: o.a ?? [],
    ips: o.ip ?? [],
  });
  it('общий кошелёк-отправитель, адрес вывода, IP', () => {
    const s = computeLinkSignals(fp('a', { w: ['TW1'], a: ['TA1'], ip: ['8.8.8.8'] }), [fp('b', { w: ['TW1'] }), fp('c', { a: ['TA1'] }), fp('d', { ip: ['8.8.8.8'] })]);
    expect(s.map((x) => `${x.kind}:${x.withUserId}`).sort()).toEqual(['shared_deposit_wallet:b', 'shared_ip:d', 'shared_withdraw_address:c']);
  });
  it('локальные IP связи не дают', () => {
    expect(isMeaningfulIp('127.0.0.1')).toBe(false);
    expect(isMeaningfulIp('local')).toBe(false);
    expect(computeLinkSignals(fp('a', { ip: ['127.0.0.1'] }), [fp('b', { ip: ['127.0.0.1'] })])).toEqual([]);
  });
  it('самореферал: связь со вторым участником пары; email с +меткой и точками gmail', () => {
    const s = computeLinkSignals(fp('a', { w: ['TW1'] }), [fp('b', { w: ['TW1'] })], { counterpartUserId: 'b' });
    expect(s.some((x) => x.kind === 'self_referral' && x.withUserId === 'b')).toBe(true);
    expect(normalizeEmail('Iv.An+promo@GoogleMail.com')).toBe('ivan@gmail.com');
    const byEmail = computeLinkSignals(fp('a', { email: 'ivan@gmail.com' }), [fp('b', { email: 'i.van+x@gmail.com' })], { counterpartUserId: 'b' });
    expect(byEmail).toEqual([{ kind: 'self_referral', withUserId: 'b', value: 'email' }]);
  });
  it('расхождение страны формы и IP', () => {
    const s = computeLinkSignals({ ...fp('a'), country: 'CY', registrationIpCountry: 'RU' }, []);
    expect(s).toEqual([{ kind: 'country_mismatch', value: 'CY≠RU' }]);
  });
});

describe('атрибуция: first-click, срок, параметры', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  it('cookie: кодирование и разбор, мусор отвергается', () => {
    const v = encodeClick('ABCD2345', now);
    expect(decodeClick(v, 'ref')).toEqual({ value: 'ABCD2345', at: new Date(Math.floor(now.getTime() / 1000) * 1000) });
    expect(decodeClick('x', 'ref')).toBeNull();
    expect(decodeClick('ab<script>.123', 'ref')).toBeNull();
    expect(decodeClick('welcome-30.1700000000', 'promo')?.value).toBe('welcome-30');
  });
  it('first-click: действующая cookie не перезаписывается чужой ссылкой', () => {
    const existing = { ref: encodeClick('FIRST111', new Date('2026-11-01T00:00:00Z')) };
    expect(cookiesForClick({ params: { ref: 'SECOND22' }, existing, now, windowDays: 30 })).toEqual([]);
  });
  it('истёкшая cookie заменяется новым кликом; срок = из настроек', () => {
    const existing = { ref: encodeClick('FIRST111', new Date('2026-10-01T00:00:00Z')) };
    const set = cookiesForClick({ params: { ref: 'second22', promo: 'Welcome-30' }, existing, now, windowDays: 30 });
    expect(set).toEqual([
      { name: 'bp_ref', value: encodeClick('SECOND22', now), maxAge: 30 * 86_400 },
      { name: 'bp_promo', value: encodeClick('welcome-30', now), maxAge: 30 * 86_400 },
    ]);
    // Срок неизвестен (настройки не прочитаны) — сессионная cookie, срок проверит сервер.
    expect(cookiesForClick({ params: { ref: 'abcd2345' }, existing: {}, now, windowDays: null })[0]!.maxAge).toBeNull();
  });
  it('при регистрации: cookie в сроке важнее параметра; на границе срока — ещё действует; за ней — параметр', () => {
    const first = new Date(now.getTime() - 30 * 86_400_000);
    const r = resolveAttribution({ cookies: { ref: encodeClick('FIRST111', first) }, params: { ref: 'PARAM222' }, now, windowDays: 30 });
    expect(r.ref).toEqual({ value: 'FIRST111', firstClickAt: first, source: 'cookie' });
    const old = new Date(first.getTime() - 1000);
    const r2 = resolveAttribution({ cookies: { ref: encodeClick('FIRST111', old) }, params: { ref: 'PARAM222' }, now, windowDays: 30 });
    expect(r2.ref).toEqual({ value: 'PARAM222', firstClickAt: now, source: 'param' });
    const none = resolveAttribution({ cookies: { ref: encodeClick('FIRST111', old) }, params: {}, now, windowDays: 30 });
    expect(none.ref).toBeNull();
  });
  it('cookie «из будущего» — подделка, не действует', () => {
    const future = new Date(now.getTime() + 3_600_000);
    expect(resolveAttribution({ cookies: { ref: encodeClick('FIRST111', future) }, params: {}, now, windowDays: 30 }).ref).toBeNull();
  });
});

describe('доступность: платформа ∧ акция ∧ страна', () => {
  const settings: PlatformPromoSettings = { promotionsEnabled: true, attributionWindowDays: 30, blockedCountries: ['GB'] };
  const promo = { status: 'active', startsAt: T0, endsAt: day(30), countriesAllow: [] as string[], countriesDeny: ['DE'] };
  const now = new Date(day(1));
  it('флаг «акции выключены» гасит всё', () => {
    expect(promoAvailability({ settings: { ...settings, promotionsEnabled: false }, promo, clientCountry: 'CY', now })).toEqual({ available: false, reason: 'platform_disabled' });
    expect(platformAllowsPromotions({ ...settings, promotionsEnabled: false }, 'CY')).toEqual({ allowed: false, reason: 'platform_disabled' });
  });
  it('страны: платформенный запрет, запрет акции, белый список (неизвестная страна — нет)', () => {
    expect(promoAvailability({ settings, promo, clientCountry: 'gb', now })).toEqual({ available: false, reason: 'country_blocked' });
    expect(promoAvailability({ settings, promo, clientCountry: 'DE', now })).toEqual({ available: false, reason: 'country_blocked' });
    expect(promoAvailability({ settings, promo, clientCountry: null, now }).available).toBe(true);
    const allow = { ...promo, countriesAllow: ['CY'] };
    expect(promoAvailability({ settings, promo: allow, clientCountry: null, now })).toEqual({ available: false, reason: 'country_not_allowed' });
    expect(promoAvailability({ settings, promo: allow, clientCountry: 'CY', now }).available).toBe(true);
  });
  it('период и статус', () => {
    expect(promoAvailability({ settings, promo: { ...promo, status: 'paused' }, clientCountry: 'CY', now }).available).toBe(false);
    expect(promoAvailability({ settings, promo, clientCountry: 'CY', now: new Date(day(31)) })).toEqual({ available: false, reason: 'ended' });
  });
});

describe('external_ref — одна форма', () => {
  it('формы и длина ≤ 200', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(rewardRef.promo(id, id)).toBe(`promo:${id}:${id}`);
    expect(rewardRef.referral(id, 'referee')).toBe(`ref:${id}:referee`);
    expect(rewardRef.contest(id, 1)).toBe(`contest:${id}:1`);
    expect(rewardRef.cashback(id, '2026-10', id).length).toBeLessThanOrEqual(200);
  });
});
