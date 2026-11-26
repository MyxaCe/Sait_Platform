import { describe, expect, it } from 'vitest';
import type { CabinetHomeModule } from '@broker/api-client';
import { homeSlotOrder } from './module-order';

const m = (type: CabinetHomeModule['type'], enabled = true) => ({ type, enabled }) as CabinetHomeModule;

describe('главная кабинета: порядок блоков из CMS на телефоне (ТД-009 п.6)', () => {
  it('рынки выше счетов, если так в CMS; операции сразу за рынками, «пригласи друга» за счетами', () => {
    const o = homeSlotOrder([m('markets'), m('balance'), m('onboarding'), m('promotions')]);
    expect(o.markets).toBeLessThan(o.recent);
    expect(o.recent).toBeLessThan(o.balance);
    expect(o.balance).toBeLessThan(o.referral);
    expect(o.referral).toBeLessThan(o.onboarding);
    expect(o.onboarding).toBeLessThan(o.promotions);
  });

  it('выключенные и отсутствующие модули не ломают порядок', () => {
    const o = homeSlotOrder([m('promotions'), m('balance', false)]);
    expect(Number.isFinite(o.balance)).toBe(true);
    expect(o.promotions).toBe(0);
  });
});
