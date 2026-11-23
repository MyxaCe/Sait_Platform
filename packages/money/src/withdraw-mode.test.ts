import { describe, expect, it } from 'vitest';
import {
  approveWithdrawal,
  ensureWithdrawalDebited,
  markWithdrawalSent,
  rejectWithdrawal,
  requestWithdrawal,
  settleWithdrawal,
} from './withdrawals';
import {
  readClientWithdrawManualOnly,
  readWithdrawMode,
  setClientWithdrawManualOnly,
  setWithdrawMode,
} from './withdraw-mode';
import { FakeDb } from './testing/fake-db';
import { FakeTerminal } from './testing/fake-terminal';
import { USDT_TRC20_CONTRACT } from './tron';

const ADDR = USDT_TRC20_CONTRACT;
const U = 'user-1';
const OP = { operatorId: 'op-1', operatorLogin: 'fin', reason: 'проверено' };
const ADMIN = 'op-admin';
const HASH = 'd'.repeat(64);

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

async function stop(db: FakeDb) {
  const r = await setWithdrawMode(db, { operatorId: ADMIN, reason: 'атака ботов', mode: 'stop' });
  if (!r.ok) throw new Error(`«Стоп» не включён: ${JSON.stringify(r)}`);
}

describe('переключатель режима вывода', () => {
  it('по умолчанию «Ручной» — как до введения режимов', async () => {
    const { db } = setup();
    expect((await readWithdrawMode(db)).mode).toBe('manual');
  });

  it('без основания и с неизвестным режимом — отказ, ничего не записано', async () => {
    const { db } = setup();
    expect(await setWithdrawMode(db, { operatorId: ADMIN, reason: '  ', mode: 'stop' })).toEqual({
      ok: false,
      reason: 'missingReason',
    });
    expect(await setWithdrawMode(db, { operatorId: ADMIN, reason: 'x', mode: 'turbo' })).toEqual({
      ok: false,
      reason: 'invalidMode',
    });
    expect(await setWithdrawMode(db, { operatorId: ADMIN, reason: 'x', mode: 'manual' })).toEqual({
      ok: false,
      reason: 'noChange',
    });
    expect(db.journal).toHaveLength(0);
    expect(db.settings.withdraw_mode).toBe('manual');
  });

  it('смена пишется в журнал: было, стало, основание и очередь на момент переключения', async () => {
    const { db, term } = setup();
    await requested(db, term);
    const id2 = await requested(db, term);
    await approveWithdrawal(db, term, { ...OP, withdrawalId: id2 });

    const r = await setWithdrawMode(db, { operatorId: ADMIN, reason: 'атака ботов', mode: 'stop' });
    expect(r).toMatchObject({ ok: true, before: 'manual', after: 'stop' });
    const entry = db.journal.at(-1)!;
    expect(entry.action).toBe('platform.withdraw_mode.changed');
    expect(entry).toMatchObject({ operator_id: ADMIN, subject_kind: 'platform', subject_id: 'withdraw_mode' });
    expect(entry.payload).toMatchObject({
      basis: 'атака ботов',
      before: 'manual',
      after: 'stop',
      queue: { requested: 1, approved: 1 },
    });
    const state = await readWithdrawMode(db);
    expect(state).toMatchObject({ mode: 'stop', changedBy: ADMIN });
    expect(state.changedAt).not.toBeNull();
  });
});

describe('«Стоп»', () => {
  it('заявка принимается, деньги удерживаются (списание как обычно)', async () => {
    const { db, term } = setup();
    await stop(db);
    const id = await requested(db, term);
    expect(db.withdrawals.get(id)).toMatchObject({ status: 'requested', debit_state: 'debited' });
    expect(term.balances.get(U)).toBe(95_000);
  });

  it('«Одобрить» отказывает любому оператору и не трогает терминал', async () => {
    const { db, term } = setup();
    const id = await requested(db, term);
    await stop(db);
    const callsBefore = term.calls.length;
    for (const operatorId of ['op-fin', ADMIN]) {
      expect(await approveWithdrawal(db, term, { ...OP, operatorId, withdrawalId: id })).toEqual({
        ok: false,
        reason: 'withdrawalsStopped',
      });
    }
    expect(db.withdrawals.get(id)!.status).toBe('requested');
    expect(term.calls.length).toBe(callsBefore);
    expect(db.journal.some((j) => j.action === 'crypto.withdrawal.approved')).toBe(false);
  });

  it('«Отправлено» по одобренной до «Стопа» заявке отказывает', async () => {
    const { db, term } = setup();
    const id = await requested(db, term);
    expect(await approveWithdrawal(db, term, { ...OP, withdrawalId: id })).toMatchObject({ ok: true });
    await stop(db);
    expect(await markWithdrawalSent(db, { ...OP, operatorId: ADMIN, withdrawalId: id, txHash: HASH })).toEqual({
      ok: false,
      reason: 'withdrawalsStopped',
    });
    expect(db.withdrawals.get(id)).toMatchObject({ status: 'approved', payout_tx_hash: null });
  });

  it('«Отклонить» с возвратом работает', async () => {
    const { db, term } = setup();
    const id = await requested(db, term);
    await stop(db);
    expect(await rejectWithdrawal(db, term, { ...OP, withdrawalId: id })).toMatchObject({ ok: true });
    expect(db.withdrawals.get(id)!.status).toBe('rejected');
    expect(term.balances.get(U)).toBe(100_000);
  });

  it('уже отправленные до «Стопа» закрываются сверкой в сети', async () => {
    const { db, term } = setup();
    const id = await requested(db, term);
    await approveWithdrawal(db, term, { ...OP, withdrawalId: id });
    await markWithdrawalSent(db, { ...OP, withdrawalId: id, txHash: HASH });
    await stop(db);
    expect(await settleWithdrawal(db, { withdrawalId: id, fromAddress: null })).toBe(true);
    expect(db.withdrawals.get(id)!.status).toBe('settled');
  });

  it('гонка: «Стоп» включили, пока одобрение уже шло, — одобрение не проходит', async () => {
    const { db, term } = setup();
    const id = await requested(db, term);
    // Быстрая проверка до транзакции видит «Ручной»; «Стоп» коммитится раньше,
    // чем одобрение берёт строку настроек под блокировку.
    db.beforeModeLock = () => {
      db.settings.withdraw_mode = 'stop';
    };
    expect(await approveWithdrawal(db, term, { ...OP, operatorId: ADMIN, withdrawalId: id })).toEqual({
      ok: false,
      reason: 'withdrawalsStopped',
    });
    expect(db.withdrawals.get(id)!.status).toBe('requested');
    expect(db.journal.some((j) => j.action === 'crypto.withdrawal.approved')).toBe(false);
  });

  it('гонка: «Стоп» во время «Отправлено» — хэш не записан', async () => {
    const { db, term } = setup();
    const id = await requested(db, term);
    await approveWithdrawal(db, term, { ...OP, withdrawalId: id });
    db.beforeModeLock = () => {
      db.settings.withdraw_mode = 'stop';
    };
    expect(await markWithdrawalSent(db, { ...OP, withdrawalId: id, txHash: HASH })).toEqual({
      ok: false,
      reason: 'withdrawalsStopped',
    });
    expect(db.withdrawals.get(id)).toMatchObject({ status: 'approved', payout_tx_hash: null });
  });

  it('проверка под блокировкой идёт в той же транзакции, что и смена статуса', async () => {
    const { db, term } = setup();
    const id = await requested(db, term);
    db.log.length = 0;
    await approveWithdrawal(db, term, { ...OP, withdrawalId: id });
    const begin = db.log.lastIndexOf('BEGIN');
    const lock = db.log.findIndex((q) => /FOR SHARE/.test(q));
    const update = db.log.findIndex((q) => /SET status = 'approved'/.test(q));
    expect(lock).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(lock);
    // FakeDb пишет в log только exec-запросы (BEGIN/COMMIT обрабатывает connect),
    // поэтому порядок «блокировка → UPDATE» внутри одного вызова и есть транзакция.
    expect(begin).toBe(-1);
  });

  it('снятие «Стопа» возвращает обычный путь', async () => {
    const { db, term } = setup();
    const id = await requested(db, term);
    await stop(db);
    expect(await setWithdrawMode(db, { operatorId: ADMIN, reason: 'атака отбита', mode: 'manual' })).toMatchObject({
      ok: true,
    });
    expect(await approveWithdrawal(db, term, { ...OP, withdrawalId: id })).toMatchObject({ ok: true });
  });

  it('«Авто» пока исполняется как «Ручной»: одобрение и хэш вручную', async () => {
    const { db, term } = setup();
    await setWithdrawMode(db, { operatorId: ADMIN, reason: 'проба', mode: 'auto' });
    const id = await requested(db, term);
    expect(await approveWithdrawal(db, term, { ...OP, withdrawalId: id })).toMatchObject({ ok: true });
    expect(await markWithdrawalSent(db, { ...OP, withdrawalId: id, txHash: HASH })).toMatchObject({ ok: true });
  });

  it('списание, начатое до «Стопа», доводится: деньги удерживаются, а не теряются', async () => {
    const { db, term } = setup();
    term.next = ['unavailable'];
    const r = await requestWithdrawal(db, term, { userId: U, toAddress: ADDR, amountMinor: 5000 });
    expect(r.ok).toBe(true);
    const id = [...db.withdrawals.keys()][0]!;
    expect(db.withdrawals.get(id)!.debit_state).toBe('pending');
    await stop(db);
    expect(await ensureWithdrawalDebited(db, term, id)).toEqual({ state: 'debited' });
    expect(term.balances.get(U)).toBe(95_000);
  });
});

describe('флаг клиента «только ручной вывод»', () => {
  it('ставится и снимается с основанием, каждое изменение — в журнал', async () => {
    const { db } = setup();
    expect(await readClientWithdrawManualOnly(db, U)).toBe(false);
    const on = await setClientWithdrawManualOnly(db, { operatorId: 'op-fin', userId: U, reason: 'подозрение', value: true });
    expect(on).toMatchObject({ ok: true });
    expect(await readClientWithdrawManualOnly(db, U)).toBe(true);
    expect(db.journal.at(-1)).toMatchObject({
      action: 'client.money.withdraw_manual_only_on',
      subject_kind: 'client',
      subject_id: U,
    });
    expect(db.journal.at(-1)!.payload).toMatchObject({ basis: 'подозрение', before: false, after: true });

    const off = await setClientWithdrawManualOnly(db, { operatorId: 'op-fin', userId: U, reason: 'проверен', value: false });
    expect(off).toMatchObject({ ok: true });
    expect(db.journal.at(-1)!.action).toBe('client.money.withdraw_manual_only_off');
  });

  it('без основания, повтор того же значения и неизвестный клиент — отказ без записи', async () => {
    const { db } = setup();
    expect(await setClientWithdrawManualOnly(db, { operatorId: 'o', userId: U, reason: '', value: true })).toEqual({
      ok: false,
      reason: 'missingReason',
    });
    expect(await setClientWithdrawManualOnly(db, { operatorId: 'o', userId: U, reason: 'x', value: false })).toEqual({
      ok: false,
      reason: 'noChange',
    });
    expect(await setClientWithdrawManualOnly(db, { operatorId: 'o', userId: 'nobody', reason: 'x', value: true })).toEqual({
      ok: false,
      reason: 'noClient',
    });
    expect(db.journal).toHaveLength(0);
  });

  it('при «Ручном» поведение вывода не меняется', async () => {
    const { db, term } = setup();
    await setClientWithdrawManualOnly(db, { operatorId: 'op-fin', userId: U, reason: 'подозрение', value: true });
    const id = await requested(db, term);
    expect(await approveWithdrawal(db, term, { ...OP, withdrawalId: id })).toMatchObject({ ok: true });
  });
});
