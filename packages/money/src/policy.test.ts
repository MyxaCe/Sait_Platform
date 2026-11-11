import { describe, expect, it } from 'vitest';
import {
  computeMoneyPolicy,
  DEFAULT_PLATFORM_SETTINGS,
  type KycSetting,
  type MoneyPolicyInputs,
} from './policy';
import { FakeDb } from './testing/fake-db';
import { resolveMoneyPolicy } from './policy';

/**
 * Политика — ВСЕ комбинации гейтов. Ожидание считается здесь независимой
 * формулой по дизайну (§0, §3), а не повтором кода резолвера.
 */
const BOOLS = [false, true];
const KYC: KycSetting[] = ['inherit', 'required', 'not_required'];

function* combos(): Generator<MoneyPolicyInputs> {
  for (const blocked of BOOLS)
    for (const frozen of BOOLS)
      for (const withdrawBanned of BOOLS)
        for (const kycVerified of BOOLS)
          for (const depositRequiresKyc of BOOLS)
            for (const withdrawRequiresKyc of BOOLS)
              for (const depositKyc of KYC)
                for (const withdrawKyc of KYC)
                  for (const unverifiedWithdrawBps of [0, 500])
                    yield {
                      clientExists: true,
                      blocked,
                      kycVerified,
                      settings: { ...DEFAULT_PLATFORM_SETTINGS, depositRequiresKyc, withdrawRequiresKyc, unverifiedWithdrawBps },
                      flags: { depositKyc, withdrawKyc, frozen, withdrawBanned },
                    };
}

const needs = (flag: KycSetting, platform: boolean) =>
  flag === 'required' ? true : flag === 'not_required' ? false : platform;

describe('resolveMoneyPolicy · все комбинации гейтов', () => {
  const all = [...combos()];

  it(`перебрано ${2 ** 7 * 9} комбинаций`, () => {
    expect(all).toHaveLength(1152);
  });

  it('ввод/вывод/реальная торговля совпадают с формулой дизайна в каждой', () => {
    for (const c of all) {
      const p = computeMoneyPolicy(c);
      const depKyc = needs(c.flags.depositKyc, c.settings.depositRequiresKyc);
      const wdKyc = needs(c.flags.withdrawKyc, c.settings.withdrawRequiresKyc);
      const expDeposit = !c.blocked && (!depKyc || c.kycVerified);
      // Доля вывода без верификации > 0 — вывод открыт, но под потолком.
      const allowance = c.settings.unverifiedWithdrawBps > 0;
      const expWithdraw =
        !c.blocked && !c.flags.frozen && !c.flags.withdrawBanned && (!wdKyc || c.kycVerified || allowance);
      expect(p.withdrawKycLimited).toBe(expWithdraw && wdKyc && !c.kycVerified);
      expect({ c, dep: p.depositAllowed, wd: p.withdrawAllowed, rt: p.realTradingAllowed }).toEqual({
        c,
        dep: expDeposit,
        wd: expWithdraw,
        rt: !c.blocked && !c.flags.frozen,
      });
      // Разрешено ⇔ причин нет.
      expect(p.depositReasons.length === 0).toBe(p.depositAllowed);
      expect(p.withdrawReasons.length === 0).toBe(p.withdrawAllowed);
    }
  });

  it('источник KYC-гейта: inherit → платформа, иначе клиент', () => {
    const base = all[0]!;
    const inherit = computeMoneyPolicy({ ...base, flags: { ...base.flags, withdrawKyc: 'inherit' } });
    expect(inherit.withdrawKyc.source).toBe('platform');
    const own = computeMoneyPolicy({ ...base, flags: { ...base.flags, withdrawKyc: 'not_required' } });
    expect(own.withdrawKyc).toEqual({ required: false, source: 'client' });
  });

  it('заморозка закрывает вывод, но НЕ ввод (пришедшие деньги зачисляются)', () => {
    const p = computeMoneyPolicy({
      clientExists: true,
      blocked: false,
      kycVerified: true,
      settings: DEFAULT_PLATFORM_SETTINGS,
      flags: { depositKyc: 'inherit', withdrawKyc: 'inherit', frozen: true, withdrawBanned: false },
    });
    expect(p.depositAllowed).toBe(true);
    expect(p.withdrawAllowed).toBe(false);
    expect(p.withdrawReasons).toEqual(['frozen']);
  });

  it('умолчания платформы: ввод без KYC, вывод без KYC — только в пределах 5 %', () => {
    const p = computeMoneyPolicy({
      clientExists: true,
      blocked: false,
      kycVerified: false,
      settings: DEFAULT_PLATFORM_SETTINGS,
      flags: { depositKyc: 'inherit', withdrawKyc: 'inherit', frozen: false, withdrawBanned: false },
    });
    expect(p.depositAllowed).toBe(true);
    expect(p.withdrawAllowed).toBe(true);
    expect(p.withdrawKycLimited).toBe(true);
    expect(p.unverifiedWithdraw).toEqual({ bps: 500, source: 'platform' });
  });

  it('доля 0 % (платформа или клиент) — прежнее поведение: вывод только после KYC', () => {
    const base = {
      clientExists: true,
      blocked: false,
      kycVerified: false,
      flags: { depositKyc: 'inherit', withdrawKyc: 'inherit', frozen: false, withdrawBanned: false } as const,
    };
    const platform0 = computeMoneyPolicy({ ...base, settings: { ...DEFAULT_PLATFORM_SETTINGS, unverifiedWithdrawBps: 0 } });
    expect(platform0.withdrawReasons).toEqual(['kyc_required']);
    expect(platform0.withdrawKycLimited).toBe(false);
    const client0 = computeMoneyPolicy({ ...base, settings: DEFAULT_PLATFORM_SETTINGS, unverifiedWithdrawBpsOverride: 0 });
    expect(client0.withdrawReasons).toEqual(['kyc_required']);
    expect(client0.unverifiedWithdraw).toEqual({ bps: 0, source: 'client' });
    // Переопределение у клиента сильнее платформы и в обратную сторону.
    const client10 = computeMoneyPolicy({
      ...base,
      settings: { ...DEFAULT_PLATFORM_SETTINGS, unverifiedWithdrawBps: 0 },
      unverifiedWithdrawBpsOverride: 1000,
    });
    expect(client10.withdrawAllowed).toBe(true);
    expect(client10.unverifiedWithdraw).toEqual({ bps: 1000, source: 'client' });
  });

  it('верифицированный клиент — лимит не действует', () => {
    const p = computeMoneyPolicy({
      clientExists: true,
      blocked: false,
      kycVerified: true,
      settings: DEFAULT_PLATFORM_SETTINGS,
      flags: { depositKyc: 'inherit', withdrawKyc: 'inherit', frozen: false, withdrawBanned: false },
    });
    expect(p.withdrawAllowed).toBe(true);
    expect(p.withdrawKycLimited).toBe(false);
  });

  it('нет клиента — всё закрыто (fail-closed)', async () => {
    const p = await resolveMoneyPolicy('nobody', new FakeDb());
    expect(p.depositAllowed).toBe(false);
    expect(p.withdrawAllowed).toBe(false);
    expect(p.realTradingAllowed).toBe(false);
    expect(p.reasons).toEqual(['no_client']);
  });

  it('из базы: KYC verified + индивидуальное «вывод без KYC» читаются', async () => {
    const db = new FakeDb();
    db.clients.set('u', { kycState: 'pending', withdrawKyc: 'not_required' });
    const p = await resolveMoneyPolicy('u', db);
    expect(p.kycVerified).toBe(false);
    expect(p.withdrawAllowed).toBe(true);
  });
});
