import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '@broker/support/testing';
import { renderLiveParams } from './resolve';
import { readLiveSnapshot } from './server';

const CASHBACK = { percentBps: 1500, minPayoutMinor: 100, capPerPeriodMinor: 0, kycRequired: false };
const REFERRAL = {
  referrerRewardMinor: 1000,
  refereeRewardMinor: 500,
  kycRequired: true,
  minDepositMinor: 1000,
  turnoverNotionalMinor: 0,
  minHoldSeconds: 0,
  windowDays: 30,
  maxPaidReferralsPerMonth: 10,
  forfeitOnWithdrawal: false,
};

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
  await db.query(`UPDATE platform_money_settings SET min_deposit_minor = 1000, min_withdraw_minor = 2000, unverified_withdraw_bps = 500`);
  await db.query(`UPDATE leverage_portfolios SET commission_bps = 10 WHERE key = 'pro'`);
  await db.query(
    `INSERT INTO leverage_portfolios (key, title, base_leverage, sort_order, is_public) VALUES ('hidden', 'Hidden', 400, 5, false)`,
  );
  await db.query(`UPDATE support_settings SET settings = '{"hours":{"alwaysOpen":true}}'::jsonb`);
  await db.query(
    `INSERT INTO promotions (slug, type, title, cms_promo_id, status, rules, texts, budget_minor) VALUES
       ('cashback-15', 'cashback', 'Кешбэк', 'cms-cashback', 'active', $1, '{"ru":{"title":"Кешбэк 15 %"},"en":{"title":"Cashback"}}', 100000),
       ('paused-promo', 'cashback', 'Пауза', NULL, 'paused', $1, '{}', 100000),
       ('friends', 'referral', 'Друзья', NULL, 'active', $2, '{}', 100000),
       ('later', 'cashback', 'Позже', NULL, 'active', $1, '{}', 100000)`,
    [JSON.stringify(CASHBACK), JSON.stringify(REFERRAL)],
  );
  await db.query(`UPDATE promotions SET starts_at = now() + interval '7 days' WHERE slug = 'later'`);
});

afterAll(async () => {
  await db.close();
});

describe('снимок настроек платформы из базы', () => {
  it('читается одним запросом', async () => {
    const before = db.log.length;
    await readLiveSnapshot(db);
    expect(db.log.length - before).toBe(1);
  });

  it('деньги, портфели с классами, поддержка', async () => {
    const s = await readLiveSnapshot(db);
    expect(s.money).toEqual({ minDepositMinor: 1000, minWithdrawMinor: 2000, unverifiedWithdrawBps: 500 });
    expect(s.portfolios?.map((p) => p.key)).toEqual(['standard', 'pro', 'enc_prime']);
    expect(s.portfolios?.[0]).toMatchObject({ baseLeverage: 20, classOverrides: { crypto: 10 }, isDefault: true, isPublic: true });
    expect(s.portfolios?.[1]).toMatchObject({ baseLeverage: 50, commissionBps: 10 });
    expect(s.support).toEqual({ alwaysOpen: true, timezone: 'Europe/Moscow', week: expect.any(Object) });
    expect(s.promo).toEqual({ enabled: true, attributionWindowDays: 30 });
  });

  it('акции — только активные, без реферальной и не начавшихся', async () => {
    const s = await readLiveSnapshot(db);
    expect(s.promotions?.map((p) => p.slug)).toEqual(['cashback-15']);
    expect(s.promotions?.[0]).toMatchObject({ cmsPromoId: 'cms-cashback', texts: { ru: { title: 'Кешбэк 15 %' } } });
  });

  it('акции выключены на платформе — витрине нечего показывать', async () => {
    await db.query(`UPDATE platform_promo_settings SET promotions_enabled = false`);
    try {
      const s = await readLiveSnapshot(db);
      expect(s.promotions).toEqual([]);
      expect(s.promo?.enabled).toBe(false);
    } finally {
      await db.query(`UPDATE platform_promo_settings SET promotions_enabled = true`);
    }
  });

  it('подстановка по данным базы', async () => {
    const s = await readLiveSnapshot(db);
    const out = renderLiveParams(
      '{{deposit.min}} · {{withdraw.min}} · {{withdraw.unverifiedPercent}} · {{leverage.max}} · {{account.standard.leverage.crypto}} · {{account.hidden.name}}',
      { locale: 'ru', snapshot: s, startBalanceCents: null, labels: null },
      () => {},
    );
    expect(out.replace(/ /g, ' ')).toBe('10 USDT · 20 USDT · 5 % · 1:100 · 1:10 · —');
  });
});
