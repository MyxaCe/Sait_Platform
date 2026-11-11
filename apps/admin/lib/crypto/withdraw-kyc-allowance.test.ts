import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  computeKycAllowance,
  rejectWithdrawal,
  requestWithdrawal,
  resolveKycAllowance,
  resolveMoneyPolicy,
  tronHexToBase58,
} from '@broker/money';
import { FakeTerminal } from '@broker/money/testing';
import { createTestDb, seedOperator, seedUser, type TestDb } from '@broker/support/testing';
import { updatePlatformMoneySettings } from './settings';
import { formatBpsPercent, percentToBps, setClientUnverifiedWithdrawLimit } from './withdraw-limit';

/**
 * Вывод без верификации до X % — на НАСТОЯЩЕМ Postgres (PGlite, все миграции):
 * суммарный потолок, учёт статусов заявок, fail-closed без баланса, настройка
 * платформы и переопределение у клиента с журналом.
 *
 * Формула (kyc-allowance.ts): limit = floor((баланс + Σ подтверждённых
 * списаний занимающих заявок) × bps / 10 000); used = Σ заявок requested |
 * approved | sent | settled | needs_review; остаток = limit − used.
 */

const ADDR = tronHexToBase58('41' + '33'.repeat(20));

let db: TestDb;
let admin: string;
let client: string;
let term: FakeTerminal;

async function setKyc(userId: string, state: 'unverified' | 'pending' | 'verified') {
  await db.query(
    `INSERT INTO client_verification (user_id, state) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET state = EXCLUDED.state`,
    [userId, state],
  );
}

const wd = (amountMinor: number, userId = client) =>
  requestWithdrawal(db, term, { userId, toAddress: ADDR, amountMinor });

beforeEach(async () => {
  db = await createTestDb();
  admin = await seedOperator(db, 'admin');
  client = await seedUser(db);
  await setKyc(client, 'pending');
  term = new FakeTerminal();
  term.balances.set(client, 100_000); // 1 000 USDT
});

afterEach(async () => {
  await db.close();
});

describe('формула потолка', () => {
  it('5 % от баланса до выводов, округление вниз, BigInt на крупных суммах', () => {
    expect(computeKycAllowance({ bps: 500, balanceMinor: 100_000, usage: { usedMinor: 0, usedDebitedMinor: 0 } })).toMatchObject({
      baseMinor: 100_000,
      limitMinor: 5_000,
      remainingMinor: 5_000,
    });
    // После вывода 30 USDT: база та же (970 + 30), остаток 20.
    expect(computeKycAllowance({ bps: 500, balanceMinor: 97_000, usage: { usedMinor: 3_000, usedDebitedMinor: 3_000 } })).toMatchObject({
      baseMinor: 100_000,
      limitMinor: 5_000,
      remainingMinor: 2_000,
    });
    // Списание не подтверждено: в базу не входит (сумма ещё может быть в балансе), в used — входит.
    expect(computeKycAllowance({ bps: 500, balanceMinor: 100_000, usage: { usedMinor: 3_000, usedDebitedMinor: 0 } })).toMatchObject({
      limitMinor: 5_000,
      remainingMinor: 2_000,
    });
    expect(computeKycAllowance({ bps: 333, balanceMinor: 1_001, usage: { usedMinor: 0, usedDebitedMinor: 0 } }).limitMinor).toBe(33);
    const big = computeKycAllowance({ bps: 9_999, balanceMinor: 9_000_000_000_000_000, usage: { usedMinor: 0, usedDebitedMinor: 0 } });
    expect(big.limitMinor).toBe(Number((9_000_000_000_000_000n * 9_999n) / 10_000n));
    // Отрицательный баланс не уменьшает базу ниже выведенного.
    expect(computeKycAllowance({ bps: 500, balanceMinor: -500, usage: { usedMinor: 0, usedDebitedMinor: 0 } }).limitMinor).toBe(0);
  });

  it('процент формы ↔ б.п.', () => {
    expect(percentToBps('5')).toBe(500);
    expect(percentToBps('2,5')).toBe(250);
    expect(percentToBps('0.25 %')).toBe(25);
    expect(percentToBps('0')).toBe(0);
    expect(percentToBps('100')).toBe(10_000);
    for (const bad of ['', '-1', '100.01', '1.234', 'abc', '1e2']) expect(percentToBps(bad)).toBeNull();
    expect(formatBpsPercent(500)).toBe('5 %');
    expect(formatBpsPercent(250)).toBe('2,5 %');
  });
});

describe('подача заявки без верификации (умолчание миграции — 5 %)', () => {
  it('сумма больше остатка — отказ с остатком; ровно остаток — принято', async () => {
    const policy = await resolveMoneyPolicy(client, db);
    expect(policy).toMatchObject({ withdrawAllowed: true, withdrawKycLimited: true, unverifiedWithdraw: { bps: 500, source: 'platform' } });

    expect(await wd(5_001)).toEqual({ ok: false, reason: 'kycLimitExceeded', limitMinor: 5_000, usedMinor: 0, remainingMinor: 5_000 });
    const rows0 = await db.query(`SELECT count(*)::int AS n FROM crypto_withdrawals`);
    expect(rows0.rows[0]!.n).toBe(0);

    const ok = await wd(5_000);
    expect(ok).toMatchObject({ ok: true, debit: 'debited' });
    expect(term.balances.get(client)).toBe(95_000);
    // Журнал заявки помечает, что она подана под лимитом.
    const j = await db.query(`SELECT payload FROM admin_action_journal WHERE action = 'crypto.withdrawal.requested'`);
    expect(j.rows[0]!.payload).toMatchObject({ amountMinor: 5_000, kycAllowanceBps: 500 });
  });

  it('потолок СУММАРНЫЙ: частями больше не вывести', async () => {
    expect(await wd(1_500)).toMatchObject({ ok: true });
    expect(await wd(1_500)).toMatchObject({ ok: true });
    expect(await wd(1_500)).toMatchObject({ ok: true });
    // 4 500 использовано, база 95 500 + 4 500 = 100 000 → лимит 5 000, остаток 500 < минимума 10.
    expect(await wd(1_000)).toEqual({ ok: false, reason: 'kycLimitExceeded', limitMinor: 5_000, usedMinor: 4_500, remainingMinor: 500 });
    const a = await resolveKycAllowance(db, term, client, 500);
    expect(a).toMatchObject({ balanceMinor: 95_500, baseMinor: 100_000, usedMinor: 4_500, remainingMinor: 500 });
  });

  it('учитываются ожидающие и одобренные; отклонённые и отменённые — нет', async () => {
    const r1 = await wd(3_000);
    expect(r1).toMatchObject({ ok: true });
    const id1 = (r1 as { withdrawalId: string }).withdrawalId;
    // В ожидании — занимает потолок.
    expect(await wd(2_001)).toMatchObject({ reason: 'kycLimitExceeded', remainingMinor: 2_000 });

    // Одобрено (и далее sent/settled) — всё ещё занимает.
    await db.query(`UPDATE crypto_withdrawals SET status = 'approved' WHERE id = $1`, [id1]);
    expect(await wd(2_001)).toMatchObject({ reason: 'kycLimitExceeded', remainingMinor: 2_000 });
    await db.query(
      `UPDATE crypto_withdrawals SET status = 'settled', payout_tx_hash = $2, sent_at = now(), settled_at = now() WHERE id = $1`,
      [id1, 'd'.repeat(64)],
    );
    expect(await wd(2_001)).toMatchObject({ reason: 'kycLimitExceeded', remainingMinor: 2_000 });

    // Отклонена с возвратом — потолок освобождается целиком.
    const r2 = await wd(2_000);
    const id2 = (r2 as { withdrawalId: string }).withdrawalId;
    const op = await seedOperator(db, 'finance_operator');
    expect(
      await rejectWithdrawal(db, term, { withdrawalId: id2, operatorId: op, operatorLogin: 'fin', reason: 'тест' }),
    ).toEqual({ ok: true, status: 'rejected' });
    expect(term.balances.get(client)).toBe(97_000);
    expect(await resolveKycAllowance(db, term, client, 500)).toMatchObject({ usedMinor: 3_000, remainingMinor: 2_000 });
    expect(await wd(2_000)).toMatchObject({ ok: true });
  });

  it('списание с неизвестным исходом занимает потолок (строже)', async () => {
    term.next = ['apply-then-unavailable'];
    expect(await wd(4_000)).toMatchObject({ ok: true, debit: 'pending' });
    // Баланс уже 96 000, списание не подтверждено: база 96 000, лимит 4 800, used 4 000.
    expect(await wd(1_000)).toMatchObject({ reason: 'kycLimitExceeded', remainingMinor: 800 });
  });

  it('терминал не дал баланс — отказ (fail-closed), заявка не создана', async () => {
    term.accountsUnavailable = true;
    expect(await wd(1_000)).toEqual({ ok: false, reason: 'kycLimitUnavailable' });
    const rows = await db.query(`SELECT count(*)::int AS n FROM crypto_withdrawals`);
    expect(rows.rows[0]!.n).toBe(0);
    expect(term.calls.filter((c) => c.op === 'withdraw')).toHaveLength(0);
  });

  it('верифицированный клиент — без лимита и без чтения баланса', async () => {
    await setKyc(client, 'verified');
    expect(await wd(50_000)).toMatchObject({ ok: true });
    expect(term.calls.filter((c) => c.op === 'accounts')).toHaveLength(0);
  });

  it('индивидуально «вывод без KYC» — без лимита', async () => {
    await db.query(`INSERT INTO client_money_flags (user_id, withdraw_kyc) VALUES ($1, 'not_required')`, [client]);
    expect(await wd(50_000)).toMatchObject({ ok: true });
  });
});

describe('настройка платформы и переопределение у клиента', () => {
  const NEXT = { depositRequiresKyc: false, withdrawRequiresKyc: true, minDepositMinor: 1000, minWithdrawMinor: 1000 };

  it('платформа 0 % — прежнее поведение (только после KYC); 10 % — потолок вдвое выше', async () => {
    expect(await updatePlatformMoneySettings({ operatorId: admin, reason: 'решение владельца', next: { ...NEXT, unverifiedWithdrawBps: 0 } }, db)).toMatchObject({ ok: true });
    expect(await wd(1_000)).toEqual({ ok: false, reason: 'policy', policyReasons: ['kyc_required'] });

    expect(await updatePlatformMoneySettings({ operatorId: admin, reason: 'решение владельца', next: { ...NEXT, unverifiedWithdrawBps: 1000 } }, db)).toMatchObject({ ok: true });
    expect(await wd(10_001)).toMatchObject({ reason: 'kycLimitExceeded', limitMinor: 10_000 });
    const j = await db.query(
      `SELECT payload FROM admin_action_journal WHERE action = 'platform.money_settings.updated' ORDER BY seq`,
    );
    expect(j.rows.map((r) => (r.payload as { after: { unverifiedWithdrawBps: number } }).after.unverifiedWithdrawBps)).toEqual([0, 1000]);
  });

  it('переопределение у клиента: свой %, 0 %, наследование; основание и журнал до/после', async () => {
    expect(await setClientUnverifiedWithdrawLimit({ operatorId: admin, userId: client, reason: ' ', bps: 100 }, db)).toEqual({
      ok: false,
      reason: 'missingReason',
    });
    expect(await setClientUnverifiedWithdrawLimit({ operatorId: admin, userId: client, reason: 'x', bps: 10_001 }, db)).toEqual({
      ok: false,
      reason: 'invalidPercent',
    });

    expect(await setClientUnverifiedWithdrawLimit({ operatorId: admin, userId: client, reason: 'VIP', bps: 2000 }, db)).toMatchObject({ ok: true });
    expect((await resolveMoneyPolicy(client, db)).unverifiedWithdraw).toEqual({ bps: 2000, source: 'client' });
    expect(await wd(20_001)).toMatchObject({ reason: 'kycLimitExceeded', limitMinor: 20_000 });

    expect(await setClientUnverifiedWithdrawLimit({ operatorId: admin, userId: client, reason: 'VIP', bps: 2000 }, db)).toEqual({
      ok: false,
      reason: 'noChange',
    });

    expect(await setClientUnverifiedWithdrawLimit({ operatorId: admin, userId: client, reason: 'подозрение', bps: 0 }, db)).toMatchObject({ ok: true });
    expect(await wd(1_000)).toEqual({ ok: false, reason: 'policy', policyReasons: ['kyc_required'] });

    expect(await setClientUnverifiedWithdrawLimit({ operatorId: admin, userId: client, reason: 'снято', bps: null }, db)).toMatchObject({ ok: true });
    expect((await resolveMoneyPolicy(client, db)).unverifiedWithdraw).toEqual({ bps: 500, source: 'platform' });

    const j = await db.query(
      `SELECT operator_id, subject_id, payload FROM admin_action_journal
        WHERE action = 'client.money.unverified_withdraw_limit_changed' ORDER BY seq`,
    );
    expect(j.rows.map((r) => r.payload)).toEqual([
      { basis: 'VIP', field: 'unverifiedWithdrawBps', before: null, after: 2000 },
      { basis: 'подозрение', field: 'unverifiedWithdrawBps', before: 2000, after: 0 },
      { basis: 'снято', field: 'unverifiedWithdrawBps', before: 0, after: null },
    ]);
    expect(j.rows.every((r) => r.operator_id === admin && r.subject_id === client)).toBe(true);
    const flags = await db.query(`SELECT last_journal_seq FROM client_money_flags WHERE user_id = $1`, [client]);
    expect(flags.rows[0]!.last_journal_seq).not.toBeNull();
  });

  it('CHECK в базе не пускает долю вне 0..10000', async () => {
    await expect(db.query(`UPDATE platform_money_settings SET unverified_withdraw_bps = 10001 WHERE id = 1`)).rejects.toThrow();
    await db.query(`INSERT INTO client_money_flags (user_id) VALUES ($1)`, [client]);
    await expect(db.query(`UPDATE client_money_flags SET unverified_withdraw_bps = -1 WHERE user_id = $1`, [client])).rejects.toThrow();
  });
});
