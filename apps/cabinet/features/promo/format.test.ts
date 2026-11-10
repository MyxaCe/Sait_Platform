import { describe, expect, it, vi } from 'vitest';
import type { ParticipationView, PromoCardView } from '@broker/promo';
vi.mock('@/lib/promo-actions', () => ({ enrollPromotionAction: () => undefined, joinContestAction: () => undefined }));
import { enrollMessageKey } from './EnrollForm';
import { joinMessageKey } from './JoinContestForm';
import {
  bpsPercent,
  contestTab,
  daysLeft,
  defaultContest,
  feeShape,
  hasLiveContest,
  holdParts,
  pickHomePromos,
  progressRatio,
  signedBpsPercent,
} from './format';

/**
 * Помощники экранов акций: проценты из б.п., сроки из дат, выбор акций для
 * главной и конкурса по умолчанию. Ни одной цифры акции здесь нет — только
 * преобразование данных.
 */

describe('проценты из б.п.', () => {
  it('ru: запятая, неразрывный пробел перед %, без хвостовых нулей', () => {
    expect(bpsPercent(3000, 'ru')).toBe('30 %');
    expect(bpsPercent(15, 'ru')).toBe('0,15 %');
    expect(bpsPercent(5, 'ru')).toBe('0,05 %');
    expect(bpsPercent(3, 'en')).toBe('0.03%');
  });
  it('доходность со знаком и типографским минусом', () => {
    expect(signedBpsPercent(1696, 'ru')).toBe('+16,96 %');
    expect(signedBpsPercent(-501, 'ru')).toBe('−5,01 %');
    expect(signedBpsPercent(0, 'ru')).toBe('0 %');
  });
});

describe('сроки и прогресс', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  it('осталось дней — вверх, прошедший срок — 0, нет даты — null', () => {
    expect(daysLeft('2026-11-11T11:00:00Z', now)).toBe(1);
    expect(daysLeft('2026-12-04T12:00:00Z', now)).toBe(24);
    expect(daysLeft('2026-11-01T00:00:00Z', now)).toBe(0);
    expect(daysLeft(null, now)).toBeNull();
    expect(daysLeft('not-a-date', now)).toBeNull();
  });
  it('доля оборота: выполнено — 1; нет чисел — 0 (не «выдумываем» прогресс)', () => {
    expect(progressRatio(340_000, 900_000, false)).toBeCloseTo(0.3778, 3);
    expect(progressRatio(undefined, 900_000, false)).toBe(0);
    expect(progressRatio(100, 0, false)).toBe(0);
    expect(progressRatio(2_000_000, 900_000, false)).toBe(1);
    expect(progressRatio(undefined, undefined, true)).toBe(1);
  });
  it('удержание: кратное минуте — в минутах', () => {
    expect(holdParts(120)).toEqual({ value: 2, unit: 'min' });
    expect(holdParts(45)).toEqual({ value: 45, unit: 'sec' });
  });
});

const part = (over: Partial<ParticipationView>): ParticipationView => ({
  promotionId: 'p',
  slug: 'p',
  type: 'deposit_bonus',
  texts: { title: 't', summary: '', terms: '' },
  rules: null,
  status: 'enrolled',
  enrolledAt: '2026-11-01T00:00:00Z',
  state: 'in_progress',
  reason: null,
  conditions: [],
  deadline: null,
  expectedRewardMinor: null,
  cashback: null,
  ...over,
});
const card = (over: Partial<PromoCardView>): PromoCardView =>
  ({
    id: 'a',
    slug: 'a',
    type: 'cashback',
    cmsPromoId: null,
    texts: { title: 't', summary: '', terms: '' },
    rules: { type: 'cashback', percentBps: 1, minPayoutMinor: 0, capPerPeriodMinor: 0, kycRequired: false },
    startsAt: null,
    endsAt: null,
    enrollable: true,
    ...over,
  }) as PromoCardView;

describe('главная: 1–2 релевантные акции', () => {
  it('сначала мои открытые участия; закрытые не показываем', () => {
    const picks = pickHomePromos({
      participating: [
        part({ promotionId: 'old', status: 'expired' }),
        part({ promotionId: 'cb', type: 'cashback' }),
        part({ promotionId: 'bonus' }),
      ],
      available: [card({ id: 'x' })],
    });
    expect(picks.map((p) => (p.kind === 'participation' ? p.item.promotionId : p.item.id))).toEqual(['bonus', 'cb']);
  });
  it('нет участий — доступные, вступаемые выше конкурса; пусто — пусто', () => {
    const picks = pickHomePromos({
      participating: [],
      available: [card({ id: 'contest', type: 'contest', enrollable: false }), card({ id: 'cb' })],
    });
    expect(picks.map((p) => (p.kind === 'available' ? p.item.id : ''))).toEqual(['cb', 'contest']);
    expect(pickHomePromos({ participating: [], available: [] })).toEqual([]);
  });
});

describe('конкурс по умолчанию', () => {
  const c = (id: string, phase: 'upcoming' | 'running' | 'finished' | 'finalized' | 'draft', endsAt: string) => ({
    promotionId: id,
    phase,
    startsAt: '2026-11-01T00:00:00Z',
    endsAt,
  });
  it('идущий › будущий › последний завершённый', () => {
    expect(defaultContest([c('f', 'finalized', '2026-10-01T00:00:00Z'), c('r', 'running', '2026-11-20T00:00:00Z')])?.promotionId).toBe('r');
    expect(defaultContest([c('f', 'finalized', '2026-10-01T00:00:00Z'), c('u', 'upcoming', '2026-12-20T00:00:00Z')])?.promotionId).toBe('u');
    expect(
      defaultContest([c('f1', 'finalized', '2026-09-01T00:00:00Z'), c('f2', 'finished', '2026-10-01T00:00:00Z')])?.promotionId,
    ).toBe('f2');
    expect(defaultContest([c('d', 'draft', '2026-10-01T00:00:00Z')])).toBeNull();
    expect(contestTab({ phase: 'draft' })).toBeNull();
  });
  it('пункт меню «Конкурс» — только при идущем или будущем', () => {
    expect(hasLiveContest([{ phase: 'finalized' }])).toBe(false);
    expect(hasLiveContest([{ phase: 'upcoming' }])).toBe(true);
    expect(hasLiveContest([])).toBe(false);
  });
});

describe('стоимость сделки', () => {
  it('наценка / комиссия / обе / ничего — из б.п. портфеля', () => {
    expect(feeShape(15, 0)).toEqual({ kind: 'markup', markupBps: 15 });
    expect(feeShape(0, 3)).toEqual({ kind: 'commission', commissionBps: 3 });
    expect(feeShape(5, 4)).toEqual({ kind: 'both', markupBps: 5, commissionBps: 4 });
    expect(feeShape(0, 0)).toEqual({ kind: 'none' });
    expect(feeShape(Number.NaN, 0)).toEqual({ kind: 'none' });
  });
});

describe('исходы «Участвовать»', () => {
  it('акция: известная причина — своя подпись, незнакомая — общая', () => {
    expect(enrollMessageKey({ state: 'ok' })).toBe('enrollOk');
    expect(enrollMessageKey({ state: 'error', reason: 'country_blocked' })).toBe('enrollError.country_blocked');
    expect(enrollMessageKey({ state: 'error', reason: 'whatever' })).toBe('enrollError.unavailable');
    expect(enrollMessageKey({ state: 'idle' })).toBeNull();
  });
  it('конкурс: открытые позиции на демо — отдельное объяснение клиенту', () => {
    expect(joinMessageKey({ state: 'error', reason: 'reset_refused', detail: 'account_not_flat' })).toBe('joinError.account_not_flat');
    expect(joinMessageKey({ state: 'error', reason: 'reset_refused', detail: null })).toBe('joinError.reset_refused');
    expect(joinMessageKey({ state: 'error', reason: 'reset_unavailable' })).toBe('joinError.reset_unavailable');
    expect(joinMessageKey({ state: 'error', reason: 'brand_new' })).toBe('joinError.other');
    expect(joinMessageKey({ state: 'too-often' })).toBe('joinError.tooOften');
  });
});
