import { describe, expect, it } from 'vitest';
import { FakeTerminal } from '@broker/money/testing';
import { approveReward, ensureRewardCredited, enqueueRewardWithinTx, rejectReward, retryRewardCredit } from './queue';
import { FakeQueueDb } from './testing/fake-queue-db';

/**
 * Очередь начислений: деньги только через одобрение, бюджет не превышается
 * (в транзакции), начисление идемпотентно по external_ref, гонка двух
 * одобрений — ровно одно зачисление.
 */

const OP = { operatorId: '00000000-0000-4000-8000-00000000a001', operatorLogin: 'i.kovaleva' };
const USER = '00000000-0000-4000-8000-0000000c0001';
const PROMO = '00000000-0000-4000-8000-0000000f0001';

/** Терминал с задержкой — чтобы вызовы реально перекрывались во времени. */
class SlowTerminal extends FakeTerminal {
  override async deposit(userId: string, body: { amount_minor: number; external_ref: string }) {
    await new Promise((r) => setTimeout(r, 5));
    return super.deposit(userId, body);
  }
}

function setup(budget = 30_000, spent = 0) {
  const db = new FakeQueueDb();
  db.promotions.set(PROMO, { id: PROMO, budget_minor: budget, spent_minor: spent });
  const terminal = new SlowTerminal();
  return { db, terminal };
}

describe('очередь начислений', () => {
  it('постановка идемпотентна по external_ref и пишет журнал', async () => {
    const { db } = setup();
    const c = await db.connect();
    const draft = {
      kind: 'promo' as const,
      promotionId: PROMO,
      userId: USER,
      amountMinor: 15_000,
      externalRef: `promo:${PROMO}:${USER}`,
      basis: {},
      signals: [],
    };
    const a = await enqueueRewardWithinTx(c, draft);
    const b = await enqueueRewardWithinTx(c, draft);
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(db.rewards.size).toBe(1);
    expect(db.journal.map((j) => j.action)).toEqual(['promo.reward.queued']);
  });

  it('одобрение: без основания — отказ; с основанием — бюджет зарезервирован, деньги на счёте, журнал', async () => {
    const { db, terminal } = setup();
    const r = db.addReward({ promotion_id: PROMO, user_id: USER, amount_minor: 15_000, external_ref: 'promo:p:u' });
    expect(await approveReward(db, terminal, { ...OP, rewardId: r.id, reason: '  ' })).toEqual({ ok: false, reason: 'missingReason' });
    const out = await approveReward(db, terminal, { ...OP, rewardId: r.id, reason: 'KYC ok, связей нет' });
    expect(out).toMatchObject({ ok: true, credit: { state: 'credited' } });
    expect(db.promotions.get(PROMO)!.spent_minor).toBe(15_000);
    expect(terminal.balances.get(USER)).toBe(15_000);
    expect(db.rewards.get(r.id)!.status).toBe('credited');
    expect(db.journal.map((j) => j.action)).toEqual(['promo.reward.approved', 'promo.reward.credited']);
    expect(db.journal[0]!.payload.basis).toBe('KYC ok, связей нет');
  });

  it('бюджет не превышается: третье одобрение сверх остатка — budgetExceeded, денег нет', async () => {
    const { db, terminal } = setup(30_000);
    const ids = [1, 2, 3].map((i) =>
      db.addReward({ promotion_id: PROMO, user_id: `${USER.slice(0, -1)}${i}`, amount_minor: 15_000, external_ref: `promo:p:${i}` }).id,
    );
    expect((await approveReward(db, terminal, { ...OP, rewardId: ids[0]!, reason: 'ok' })).ok).toBe(true);
    expect((await approveReward(db, terminal, { ...OP, rewardId: ids[1]!, reason: 'ok' })).ok).toBe(true);
    expect(await approveReward(db, terminal, { ...OP, rewardId: ids[2]!, reason: 'ok' })).toEqual({ ok: false, reason: 'budgetExceeded' });
    expect(db.promotions.get(PROMO)!.spent_minor).toBe(30_000);
    expect(db.rewards.get(ids[2]!)!.status).toBe('pending');
    expect(terminal.calls.filter((c) => c.op === 'deposit')).toHaveLength(2);
  });

  it('бюджет: параллельные одобрения РАЗНЫХ начислений не перескакивают остаток', async () => {
    const { db, terminal } = setup(40_000);
    const ids = Array.from({ length: 5 }, (_, i) =>
      db.addReward({ promotion_id: PROMO, user_id: `${USER.slice(0, -1)}${i}`, amount_minor: 15_000, external_ref: `promo:p:${i}` }).id,
    );
    const results = await Promise.all(ids.map((id) => approveReward(db, terminal, { ...OP, rewardId: id, reason: 'ok' })));
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results.filter((r) => !r.ok && r.reason === 'budgetExceeded')).toHaveLength(3);
    expect(db.promotions.get(PROMO)!.spent_minor).toBe(30_000);
  });

  it('гонка двух одобрений ОДНОГО начисления: одно зачисление, второе — wrongState', async () => {
    const { db, terminal } = setup();
    const r = db.addReward({ promotion_id: PROMO, user_id: USER, amount_minor: 15_000, external_ref: 'promo:p:u' });
    const [a, b] = await Promise.all([
      approveReward(db, terminal, { ...OP, rewardId: r.id, reason: 'первый' }),
      approveReward(db, terminal, { operatorId: '00000000-0000-4000-8000-00000000a003', operatorLogin: 'm.orlova', rewardId: r.id, reason: 'второй' }),
    ]);
    const oks = [a, b].filter((x) => x.ok);
    expect(oks).toHaveLength(1);
    expect([a, b].find((x) => !x.ok)).toEqual({ ok: false, reason: 'wrongState' });
    expect(terminal.calls.filter((c) => c.op === 'deposit')).toHaveLength(1);
    expect(terminal.balances.get(USER)).toBe(15_000);
    expect(db.promotions.get(PROMO)!.spent_minor).toBe(15_000);
    expect(db.journal.filter((j) => j.action === 'promo.reward.approved')).toHaveLength(1);
  });

  it('терминал не ответил: остаётся approved; повтор тем же ref — одна проводка (идемпотентно)', async () => {
    const { db, terminal } = setup();
    const r = db.addReward({ kind: 'referral', promotion_id: PROMO, user_id: USER, amount_minor: 2_500, external_ref: 'ref:f:referee' });
    terminal.next.push('apply-then-unavailable'); // деньги легли, ответ потерян
    const out = await approveReward(db, terminal, { ...OP, rewardId: r.id, reason: 'ok' });
    expect(out).toMatchObject({ ok: true, credit: { state: 'pending' } });
    expect(db.rewards.get(r.id)!.status).toBe('approved');
    // Отклонить «исход неизвестен» нельзя — деньги могли уйти.
    expect(await rejectReward(db, { ...OP, rewardId: r.id, reason: 'x' })).toEqual({ ok: false, reason: 'wrongState' });
    const again = await ensureRewardCredited(db, terminal, r.id, OP.operatorLogin);
    expect(again).toMatchObject({ state: 'credited', replay: true });
    expect(terminal.balances.get(USER)).toBe(2_500);
    expect(db.rewards.get(r.id)!.status).toBe('credited');
    // Ещё повтор — без вызова терминала.
    const calls = terminal.calls.length;
    expect(await ensureRewardCredited(db, terminal, r.id, OP.operatorLogin)).toMatchObject({ state: 'credited' });
    expect(terminal.calls.length).toBe(calls);
  });

  it('отказ терминала → needs_review; отклонение освобождает бюджет; повтор после разбора зачисляет', async () => {
    const { db, terminal } = setup();
    const r1 = db.addReward({ promotion_id: PROMO, user_id: USER, amount_minor: 10_000, external_ref: 'promo:p:1' });
    terminal.next.push('account_quarantined');
    expect(await approveReward(db, terminal, { ...OP, rewardId: r1.id, reason: 'ok' })).toMatchObject({
      ok: true,
      credit: { state: 'needs_review', code: 'account_quarantined' },
    });
    expect(db.promotions.get(PROMO)!.spent_minor).toBe(10_000);
    expect(await rejectReward(db, { ...OP, rewardId: r1.id, reason: 'счёт в карантине' })).toEqual({ ok: true, releasedMinor: 10_000 });
    expect(db.promotions.get(PROMO)!.spent_minor).toBe(0);

    const r2 = db.addReward({ promotion_id: PROMO, user_id: USER, amount_minor: 10_000, external_ref: 'promo:p:2' });
    terminal.next.push('account_quarantined');
    await approveReward(db, terminal, { ...OP, rewardId: r2.id, reason: 'ok' });
    const retry = await retryRewardCredit(db, terminal, { ...OP, rewardId: r2.id, reason: 'карантин снят' });
    expect(retry).toMatchObject({ ok: true, credit: { state: 'credited' } });
    expect(db.journal.map((j) => j.action)).toContain('promo.reward.needs_review');
  });

  it('отклонение pending: бюджет не тронут, участие отклонено, повторное решение — wrongState', async () => {
    const { db } = setup();
    db.participations.set('part-1', { status: 'qualified' });
    const r = db.addReward({ promotion_id: PROMO, participation_id: 'part-1', user_id: USER, amount_minor: 5_000, external_ref: 'promo:p:u' });
    expect(await rejectReward(db, { ...OP, rewardId: r.id, reason: '' })).toEqual({ ok: false, reason: 'missingReason' });
    expect(await rejectReward(db, { ...OP, rewardId: r.id, reason: 'общий кошелёк с другим клиентом' })).toEqual({ ok: true, releasedMinor: 0 });
    expect(db.participations.get('part-1')!.status).toBe('rejected');
    expect(db.promotions.get(PROMO)!.spent_minor).toBe(0);
    expect(await rejectReward(db, { ...OP, rewardId: r.id, reason: 'ещё раз' })).toEqual({ ok: false, reason: 'wrongState' });
  });

  it('IB-выплата без акции — без бюджета', async () => {
    const { db, terminal } = setup();
    const r = db.addReward({ kind: 'ib', user_id: USER, amount_minor: 7_500, external_ref: 'ib:cpa:x' });
    expect(await approveReward(db, terminal, { ...OP, rewardId: r.id, reason: 'CPA' })).toMatchObject({ ok: true });
    expect(db.journal.map((j) => j.action)).toEqual(['ib.payout.approved', 'ib.payout.credited']);
  });
});
