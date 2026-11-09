import { describe, expect, it } from 'vitest';
import {
  approveWithdrawal,
  ensureWithdrawalDebited,
  flagWithdrawalForReview,
  markWithdrawalSent,
  rejectWithdrawal,
  requestWithdrawal,
  settleWithdrawal,
  settleWithdrawalManually,
} from './withdrawals';
import { FakeDb } from './testing/fake-db';
import { FakeTerminal } from './testing/fake-terminal';
import { USDT_TRC20_CONTRACT } from './tron';

const ADDR = USDT_TRC20_CONTRACT; // валидный base58check-адрес
const U = 'user-1';
const OP = { operatorId: 'op-1', operatorLogin: 'fin', reason: 'проверено' };
const HASH = 'c'.repeat(64);

function setup(balance = 100_000) {
  const db = new FakeDb();
  db.clients.set(U, { kycState: 'verified' });
  const term = new FakeTerminal();
  term.balances.set(U, balance);
  return { db, term };
}

async function requested(db: FakeDb, term: FakeTerminal, amount = 5000) {
  const r = await requestWithdrawal(db, term, { userId: U, toAddress: ADDR, amountMinor: amount });
  if (!r.ok) throw new Error(`заявка не создана: ${JSON.stringify(r)}`);
  return r.withdrawalId;
}

describe('подача заявки на вывод', () => {
  it('списание сразу (wd:<id>), заявка requested/debited, журнал requested+debited', async () => {
    const { db, term } = setup();
    const id = await requested(db, term);

    expect(term.calls[0]).toEqual({ op: 'withdraw', userId: U, ref: `wd:${id}`, amount: 5000 });
    expect(term.balances.get(U)).toBe(95_000);
    expect(db.withdrawals.get(id)).toMatchObject({ status: 'requested', debit_state: 'debited' });
    expect(db.journal.map((j) => j.action)).toEqual(['crypto.withdrawal.requested', 'crypto.withdrawal.debited']);
  });

  it('нет свободной маржи — заявка rejected с причиной, деньги не двигались', async () => {
    const { db, term } = setup(1000);
    const r = await requestWithdrawal(db, term, { userId: U, toAddress: ADDR, amountMinor: 5000 });
    expect(r).toMatchObject({ ok: false, reason: 'terminalRefused', code: 'insufficient_free_margin' });
    const row = [...db.withdrawals.values()][0]!;
    expect(row).toMatchObject({ status: 'rejected', debit_state: 'refused', reject_reason: 'insufficient_free_margin' });
    expect(term.balances.get(U)).toBe(1000);
  });

  it('проверки до записи: адрес base58check, минимум, политика', async () => {
    const { db, term } = setup();
    expect(await requestWithdrawal(db, term, { userId: U, toAddress: 'Tnope', amountMinor: 5000 })).toEqual({
      ok: false,
      reason: 'invalidAddress',
    });
    expect(await requestWithdrawal(db, term, { userId: U, toAddress: ADDR, amountMinor: 999 })).toEqual({
      ok: false,
      reason: 'belowMinimum',
    });
    db.clients.set(U, { kycState: 'pending' });
    expect(await requestWithdrawal(db, term, { userId: U, toAddress: ADDR, amountMinor: 5000 })).toMatchObject({
      reason: 'policy',
      policyReasons: ['kyc_required'],
    });
    db.clients.set(U, { kycState: 'verified', frozen: true, withdrawBanned: true });
    expect(await requestWithdrawal(db, term, { userId: U, toAddress: ADDR, amountMinor: 5000 })).toMatchObject({
      reason: 'policy',
      policyReasons: ['frozen', 'withdraw_banned'],
    });
    expect(db.withdrawals.size).toBe(0);
    expect(term.calls).toHaveLength(0);
  });

  it('терминал молчит → pending; повтор тем же ref доводит до debited ровно одним списанием', async () => {
    const { db, term } = setup();
    term.next = ['apply-then-unavailable'];
    const r = await requestWithdrawal(db, term, { userId: U, toAddress: ADDR, amountMinor: 5000 });
    expect(r).toMatchObject({ ok: true, debit: 'pending' });
    const id = (r as { withdrawalId: string }).withdrawalId;
    expect(db.withdrawals.get(id)!.debit_state).toBe('pending');

    expect(await ensureWithdrawalDebited(db, term, id)).toEqual({ state: 'debited' });
    expect(term.balances.get(U)).toBe(95_000); // списано один раз
  });
});

describe('решения оператора', () => {
  it('одобрить → внести хэш → наблюдатель: settled', async () => {
    const { db, term } = setup();
    const id = await requested(db, term);
    expect(await approveWithdrawal(db, term, { withdrawalId: id, ...OP })).toEqual({ ok: true, status: 'approved' });
    expect(await markWithdrawalSent(db, { withdrawalId: id, ...OP, txHash: HASH })).toEqual({ ok: true, status: 'sent' });
    expect(await settleWithdrawal(db, { withdrawalId: id, fromAddress: 'TOwner' })).toBe(true);
    expect(db.withdrawals.get(id)).toMatchObject({ status: 'settled', payout_tx_hash: HASH });
    expect(db.journal.map((j) => j.action).slice(-3)).toEqual([
      'crypto.withdrawal.approved',
      'crypto.withdrawal.sent',
      'crypto.withdrawal.settled',
    ]);
  });

  it('отклонить requested → возврат wd-refund:<id>, баланс восстановлен', async () => {
    const { db, term } = setup();
    const id = await requested(db, term);
    expect(await rejectWithdrawal(db, term, { withdrawalId: id, ...OP })).toEqual({ ok: true, status: 'rejected' });
    expect(term.calls.at(-1)).toMatchObject({ op: 'deposit', ref: `wd-refund:${id}`, amount: 5000 });
    expect(term.balances.get(U)).toBe(100_000);
    expect(db.withdrawals.get(id)).toMatchObject({ status: 'rejected', refunded: true });
    expect(db.journal.at(-1)!.payload).toMatchObject({ refunded: true, basis: 'проверено' });
  });

  it('отменить одобренную → cancelled с возвратом; повторно не отменить', async () => {
    const { db, term } = setup();
    const id = await requested(db, term);
    await approveWithdrawal(db, term, { withdrawalId: id, ...OP });
    expect(await rejectWithdrawal(db, term, { withdrawalId: id, ...OP })).toEqual({ ok: true, status: 'cancelled' });
    expect(term.balances.get(U)).toBe(100_000);
    expect(await rejectWithdrawal(db, term, { withdrawalId: id, ...OP })).toEqual({ ok: false, reason: 'wrongState' });
    expect(term.balances.get(U)).toBe(100_000);
  });

  it('возврат не прошёл (терминал недоступен) — статус не меняется, журнал не пишется', async () => {
    const { db, term } = setup();
    const id = await requested(db, term);
    const before = db.journal.length;
    term.next = ['unavailable'];
    expect(await rejectWithdrawal(db, term, { withdrawalId: id, ...OP })).toEqual({
      ok: false,
      reason: 'terminalUnavailable',
    });
    expect(db.withdrawals.get(id)!.status).toBe('requested');
    expect(db.journal).toHaveLength(before);
  });

  it('отклонить заявку, по которой терминал отказал в списании — без возврата', async () => {
    const { db, term } = setup(0);
    await requestWithdrawal(db, term, { userId: U, toAddress: ADDR, amountMinor: 5000 });
    const id = [...db.withdrawals.keys()][0]!;
    const deposits = term.calls.filter((c) => c.op === 'deposit');
    expect(await rejectWithdrawal(db, term, { withdrawalId: id, ...OP })).toEqual({ ok: true, status: 'rejected' });
    expect(term.calls.filter((c) => c.op === 'deposit')).toEqual(deposits);
  });

  it('pending и терминал молчит — одобрить/отклонить нельзя (debitPending), денег не создаём', async () => {
    const { db, term } = setup();
    term.next = ['unavailable'];
    const r = await requestWithdrawal(db, term, { userId: U, toAddress: ADDR, amountMinor: 5000 });
    const id = (r as { withdrawalId: string }).withdrawalId;
    term.next = ['unavailable'];
    expect(await approveWithdrawal(db, term, { withdrawalId: id, ...OP })).toEqual({ ok: false, reason: 'debitPending' });
    term.next = ['unavailable'];
    expect(await rejectWithdrawal(db, term, { withdrawalId: id, ...OP })).toEqual({ ok: false, reason: 'debitPending' });
    expect(term.balances.get(U)).toBe(100_000);
  });

  it('хэш: невалидный, чужой (уже у другой выплаты) — отказ; только из approved', async () => {
    const { db, term } = setup();
    const id1 = await requested(db, term);
    const id2 = await requested(db, term);
    expect(await markWithdrawalSent(db, { withdrawalId: id1, ...OP, txHash: HASH })).toEqual({
      ok: false,
      reason: 'wrongState',
    });
    await approveWithdrawal(db, term, { withdrawalId: id1, ...OP });
    await approveWithdrawal(db, term, { withdrawalId: id2, ...OP });
    expect(await markWithdrawalSent(db, { withdrawalId: id1, ...OP, txHash: 'zz' })).toEqual({
      ok: false,
      reason: 'invalidHash',
    });
    await markWithdrawalSent(db, { withdrawalId: id1, ...OP, txHash: HASH });
    expect(await markWithdrawalSent(db, { withdrawalId: id2, ...OP, txHash: HASH })).toEqual({
      ok: false,
      reason: 'hashUsed',
    });
  });

  it('не сошлось → needs_review без авто-возврата; дальше человек: вручную settled', async () => {
    const { db, term } = setup();
    const id = await requested(db, term);
    await approveWithdrawal(db, term, { withdrawalId: id, ...OP });
    await markWithdrawalSent(db, { withdrawalId: id, ...OP, txHash: HASH });
    expect(await flagWithdrawalForReview(db, { withdrawalId: id, reason: 'amount_mismatch' })).toBe(true);
    expect(db.withdrawals.get(id)).toMatchObject({ status: 'needs_review', review_reason: 'amount_mismatch' });
    expect(term.calls.filter((c) => c.op === 'deposit')).toHaveLength(0);
    expect(await settleWithdrawalManually(db, { withdrawalId: id, ...OP })).toEqual({ ok: true, status: 'settled' });
  });

  it('без основания — ничего', async () => {
    const { db, term } = setup();
    const id = await requested(db, term);
    expect(await approveWithdrawal(db, term, { withdrawalId: id, ...OP, reason: '' })).toEqual({
      ok: false,
      reason: 'missingReason',
    });
  });
});
