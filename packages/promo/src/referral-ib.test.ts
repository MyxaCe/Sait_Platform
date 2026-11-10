import { describe, expect, it } from 'vitest';
import type { PoolLike } from '@broker/money';
import { getMyReferral } from './cabinet';

/**
 * Клиенты IB-партнёра: этапы и статусы — по CPA-условиям ЕГО договора
 * (`ib_partners.cpa_rules`), а не по правилам реферальной программы
 * (решение штаба 10.11). У доли дохода (revshare) условий квалификации нет —
 * этапы по фактам клиента.
 *
 * Сценарий различает два источника правил: реферальная программа требует
 * депозит 10 000 USDT, договор CPA — 100 USDT. Клиент внёс 150 и прошёл KYC.
 * По программе он застрял бы на «KYC», по договору — дошёл до «депозита».
 */

const NOW = new Date('2026-11-10T12:00:00Z');
const PARTNER = '00000000-0000-4000-8000-0000000000aa';
const CLIENT = '00000000-0000-4000-8000-0000000000cc';

const REFERRAL_PROGRAM = {
  id: '00000000-0000-4000-8000-0000000000f1',
  slug: 'invite-friend',
  type: 'referral',
  title: 'Пригласи друга',
  cms_promo_id: null,
  status: 'active',
  rules: {
    referrerRewardMinor: 2_500,
    refereeRewardMinor: 2_500,
    kycRequired: true,
    minDepositMinor: 1_000_000,
    turnoverNotionalMinor: 1_000_000,
    minHoldSeconds: 120,
    windowDays: 30,
    maxPaidReferralsPerMonth: 10,
    forfeitOnWithdrawal: true,
  },
  texts: {},
  starts_at: null,
  ends_at: null,
  budget_minor: 100_000,
  spent_minor: 0,
  countries_allow: [],
  countries_deny: [],
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};

type Row = Record<string, unknown>;

/** Пул-заглушка: маршрутизация по тексту SQL (только чтения getMyReferral). */
function fakePool(opts: { partner: Row | null; rewards?: Row[] }): PoolLike {
  const route = (sql: string): Row[] => {
    if (sql.includes('FROM platform_promo_settings')) {
      return [{ promotions_enabled: true, attribution_window_days: 30, blocked_countries: [] }];
    }
    if (sql.includes('SELECT country FROM users')) return [{ country: 'CY' }];
    if (sql.includes('FROM referral_codes')) return [{ code: 'PARTNER1' }];
    if (sql.includes('FROM ib_partners')) return opts.partner ? [opts.partner] : [];
    if (sql.includes('FROM promotions WHERE type')) return [REFERRAL_PROGRAM];
    if (sql.includes('FROM referral_attributions')) {
      return [{ id: CLIENT, full_name: 'Aisha Rahman', attributed_at: '2026-11-01T00:00:00Z' }];
    }
    if (sql.includes('FROM promo_rewards')) return opts.rewards ?? [];
    if (sql.includes('FROM promo_participations')) return [];
    if (sql.includes('LEFT JOIN client_verification')) {
      return [{ id: CLIENT, created_at: '2026-11-01T00:00:00Z', country: 'AE', kyc_state: 'verified' }];
    }
    if (sql.includes('FROM crypto_deposits')) {
      return [{ id: 'd1', amount_minor: 15_000, credited_at: '2026-11-02T00:00:00Z', from_address: null }];
    }
    if (sql.includes('FROM real_trades')) return [];
    if (sql.includes('FROM crypto_withdrawals')) return [];
    throw new Error(`неожиданный запрос: ${sql.slice(0, 80)}`);
  };
  return {
    query: async (sql: string) => ({ rows: route(sql) }),
    connect: async () => {
      throw new Error('транзакции не ожидаются');
    },
  } as unknown as PoolLike;
}

const CPA = {
  id: 'p1',
  model: 'cpa',
  cpa_rules: { kycRequired: true, minDepositMinor: 10_000, turnoverNotionalMinor: 500_000, minHoldSeconds: 120, windowDays: 30 },
};

describe('клиенты IB-партнёра — по договору, а не по реферальной программе', () => {
  it('CPA: условия и цели — из cpa_rules договора', async () => {
    const v = await getMyReferral(fakePool({ partner: CPA }), PARTNER, { locale: 'ru', now: NOW });
    expect(v.isPartner).toBe(true);
    const c = v.invited[0]!;
    expect(c.conditions.find((x) => x.key === 'deposit')).toMatchObject({ met: true, target: 10_000 });
    expect(c.conditions.find((x) => x.key === 'turnover')).toMatchObject({ met: false, target: 500_000 });
    expect(c.stage).toBe('deposit');
    expect(c.deadline).toBe('2026-12-01T00:00:00.000Z');
  });

  it('CPA: начисление партнёру за клиента задаёт статус (в обработке → «условия выполнены»)', async () => {
    const v = await getMyReferral(
      fakePool({ partner: CPA, rewards: [{ friend: CLIENT, amount_minor: 7_500, status: 'pending' }] }),
      PARTNER,
      { locale: 'ru', now: NOW },
    );
    expect(v.invited[0]!.stage).toBe('qualified');
    expect(v.invited[0]!.myReward).toEqual({ amountMinor: 7_500, status: 'processing' });
  });

  it('revshare: квалификации нет — этапы по фактам, без срока', async () => {
    const v = await getMyReferral(fakePool({ partner: { id: 'p2', model: 'revshare', cpa_rules: {} } }), PARTNER, {
      locale: 'ru',
      now: NOW,
    });
    const c = v.invited[0]!;
    expect(c.conditions.map((x) => [x.key, x.met])).toEqual([
      ['kyc', true],
      ['deposit', true],
      ['turnover', false],
    ]);
    expect(c.stage).toBe('deposit');
    expect(c.deadline).toBeNull();
  });

  it('обычный клиент (не партнёр) — по правилам реферальной программы', async () => {
    const v = await getMyReferral(fakePool({ partner: null }), PARTNER, { locale: 'ru', now: NOW });
    expect(v.isPartner).toBe(false);
    const c = v.invited[0]!;
    expect(c.conditions.find((x) => x.key === 'deposit')).toMatchObject({ met: false, target: 1_000_000 });
    expect(c.stage).toBe('kyc');
  });
});
