import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { approveWithdrawal, claimDeposit, markWithdrawalSent, requestWithdrawal } from '@broker/money';
import { FakeDb, FakeTerminal } from '@broker/money/testing';
import { ChainUnavailableError, parseIncomingUsdt, parseSolidTxInfo, type ChainReader, type SolidTx } from './trongrid';
import { runTick } from './watcher';

/**
 * Проход наблюдателя целиком: фейковая база `@broker/money`, фейковый
 * терминал (идемпотентный по external_ref), сеть — фикстуры TronGrid.
 * Сетевых вызовов нет.
 */

const fx = (name: string): unknown =>
  JSON.parse(readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
const ADDR = fx('addresses.json') as { exchange: string; from: string; other: string };
const H = (c: string) => c.repeat(64);
const U = 'user-1';
const T0 = Date.parse('2025-11-09T10:00:00Z');

/** Подставная сеть: хэш → необратимая транзакция | 'pending' | 'missing' | 'down'. */
function chain(map: Record<string, SolidTx | 'pending' | 'missing' | 'down'>, incoming: unknown = { data: [] }): ChainReader {
  return {
    async getSolidTx(h) {
      const v = map[h] ?? 'missing';
      if (v === 'down') throw new ChainUnavailableError('test');
      return typeof v === 'string' ? null : v;
    },
    async txExists(h) {
      return map[h] === 'pending';
    },
    async listIncomingUsdt(address) {
      return parseIncomingUsdt(address, incoming);
    },
  };
}

function setup() {
  const db = new FakeDb();
  db.clients.set(U, { kycState: 'verified' });
  db.settings.min_deposit_minor = 1000;
  const term = new FakeTerminal();
  // FakeDb не знает SELECT-ов наблюдателя — отвечаем из его же состояния.
  const pool = {
    connect: () => db.connect(),
    query: async (sql: string, p: unknown[] = []) => {
      const s = sql.replace(/\s+/g, ' ');
      if (s.includes("FROM crypto_deposits WHERE status = 'claimed'")) {
        return { rows: [...db.deposits.values()].filter((d) => d.status === 'claimed').map((d) => ({ ...d, claimed_at: new Date(T0) })) };
      }
      if (s.includes("FROM crypto_withdrawals WHERE status = 'sent'")) {
        return { rows: [...db.withdrawals.values()].filter((w) => w.status === 'sent').map((w) => ({ ...w, sent_at: new Date(T0) })) };
      }
      if (s.includes("WHERE status = 'requested' AND debit_state = 'pending'")) {
        return { rows: [...db.withdrawals.values()].filter((w) => w.status === 'requested' && w.debit_state === 'pending').map((w) => ({ id: w.id, requested_at: new Date(T0) })) };
      }
      if (s.includes('FROM platform_money_settings')) return { rows: [db.settings] };
      return db.query(sql, p);
    },
  };
  return { db, term, pool };
}

const solid = (name: string, hash: string) => parseSolidTxInfo(hash, fx(name))!;

describe('наблюдатель · заявленные депозиты', () => {
  it('сеть подтвердила → терминал deposit(tron:<hash>) → credited; второй проход ничего не делает', async () => {
    const { db, term, pool } = setup();
    await claimDeposit(db, { userId: U, txHash: H('1') });
    const c = chain({ [H('1')]: solid('solid-deposit-ok.json', H('1')) });

    const s1 = await runTick({ pool, chain: c, terminal: term, exchangeAddress: ADDR.exchange, now: () => T0, log: () => {} });
    expect(s1.credited).toBe(1);
    expect(term.calls).toEqual([{ op: 'deposit', userId: U, ref: `tron:${H('1')}`, amount: 2512 }]);
    const row = [...db.deposits.values()][0]!;
    expect(row).toMatchObject({ status: 'credited', amount_minor: 2512, dust_raw: '3456', from_address: ADDR.from });

    const s2 = await runTick({ pool, chain: c, terminal: term, exchangeAddress: ADDR.exchange, now: () => T0, log: () => {} });
    expect(s2.credited).toBe(0);
    expect(term.calls).toHaveLength(1);
  });

  it.each([
    ['solid-wrong-recipient.json', 'wrong_recipient'],
    ['solid-fake-token.json', 'wrong_token'],
    ['solid-failed.json', 'failed'],
  ])('%s → rejected %s, денег не двигаем', async (file, reason) => {
    const { db, term, pool } = setup();
    await claimDeposit(db, { userId: U, txHash: H('2') });
    await runTick({ pool, chain: chain({ [H('2')]: solid(file, H('2')) }), terminal: term, exchangeAddress: ADDR.exchange, now: () => T0, log: () => {} });
    expect([...db.deposits.values()][0]).toMatchObject({ status: 'rejected', reject_reason: reason });
    expect(term.calls).toHaveLength(0);
  });

  it('ещё не необратима — ждём (claimed, заметка)', async () => {
    const { db, term, pool } = setup();
    await claimDeposit(db, { userId: U, txHash: H('3') });
    const s = await runTick({ pool, chain: chain({ [H('3')]: 'pending' }), terminal: term, exchangeAddress: ADDR.exchange, now: () => T0 + 3600_000, log: () => {} });
    expect(s.waiting).toBe(1);
    expect([...db.deposits.values()][0]).toMatchObject({ status: 'claimed', check_note: 'ждём необратимости блока' });
  });

  it('нет в сети: до 30 мин ждём, после — not_found', async () => {
    const { db, term, pool } = setup();
    await claimDeposit(db, { userId: U, txHash: H('4') });
    const c = chain({});
    await runTick({ pool, chain: c, terminal: term, exchangeAddress: ADDR.exchange, now: () => T0 + 60_000, log: () => {} });
    expect([...db.deposits.values()][0]!.status).toBe('claimed');
    await runTick({ pool, chain: c, terminal: term, exchangeAddress: ADDR.exchange, now: () => T0 + 31 * 60_000, log: () => {} });
    expect([...db.deposits.values()][0]).toMatchObject({ status: 'rejected', reject_reason: 'not_found' });
  });

  it('TronGrid недоступен — НЕ отклоняем, только заметка', async () => {
    const { db, term, pool } = setup();
    await claimDeposit(db, { userId: U, txHash: H('5') });
    const s = await runTick({ pool, chain: chain({ [H('5')]: 'down' }), terminal: term, exchangeAddress: ADDR.exchange, now: () => T0 + 99 * 3600_000, log: () => {} });
    expect(s.errors).toBe(1);
    expect([...db.deposits.values()][0]!.status).toBe('claimed');
  });

  it('терминал не ответил — остаётся claimed, следующий проход зачисляет ровно один раз', async () => {
    const { db, term, pool } = setup();
    await claimDeposit(db, { userId: U, txHash: H('1') });
    const c = chain({ [H('1')]: solid('solid-deposit-ok.json', H('1')) });
    term.next = ['apply-then-unavailable'];
    await runTick({ pool, chain: c, terminal: term, exchangeAddress: ADDR.exchange, now: () => T0, log: () => {} });
    expect([...db.deposits.values()][0]!.status).toBe('claimed');
    await runTick({ pool, chain: c, terminal: term, exchangeAddress: ADDR.exchange, now: () => T0, log: () => {} });
    expect([...db.deposits.values()][0]!.status).toBe('credited');
    expect(term.balances.get(U)).toBe(2512);
  });
});

describe('наблюдатель · неопознанные', () => {
  it('входящий USDT без заявки старше 10 мин → unidentified; моложе — ждём; заявленный — не трогаем', async () => {
    const { db, term, pool } = setup();
    await claimDeposit(db, { userId: U, txHash: H('7') }); // клиент заявил сам
    // 7… пришёл в T0 (заявлен клиентом), 8… — в T0+9 мин: через 12 мин ему 3 мин.
    const now = T0 + 12 * 60_000;
    const s = await runTick({
      pool,
      chain: chain({ [H('7')]: 'pending' }, fx('trc20-incoming.json')),
      terminal: term,
      exchangeAddress: ADDR.exchange,
      now: () => now,
      log: () => {},
    });
    expect(s.unidentified).toBe(0);
    const later = await runTick({
      pool,
      chain: chain({ [H('7')]: 'pending' }, fx('trc20-incoming.json')),
      terminal: term,
      exchangeAddress: ADDR.exchange,
      now: () => T0 + 20 * 60_000,
      log: () => {},
    });
    expect(later.unidentified).toBe(1);
    const un = [...db.deposits.values()].filter((d) => d.status === 'unidentified');
    expect(un.map((d) => d.tx_hash)).toEqual([H('8')]);
    expect(un[0]).toMatchObject({ user_id: null, from_address: ADDR.from, amount_raw: '5000000' });
  });
});

describe('наблюдатель · выплаты', () => {
  async function sentWithdrawal(db: FakeDb, term: FakeTerminal, toAddress: string, cents: number) {
    term.balances.set(U, 1_000_000);
    const r = await requestWithdrawal(db, term, { userId: U, toAddress, amountMinor: cents });
    const id = (r as { withdrawalId: string }).withdrawalId;
    const op = { withdrawalId: id, operatorId: 'op', operatorLogin: 'fin', reason: 'ok' };
    await approveWithdrawal(db, term, op);
    await markWithdrawalSent(db, { ...op, txHash: H('5') });
    return id;
  }

  it('получатель и сумма сошлись → settled', async () => {
    const { db, term, pool } = setup();
    const id = await sentWithdrawal(db, term, ADDR.other, 5000);
    await runTick({ pool, chain: chain({ [H('5')]: solid('solid-payout-ok.json', H('5')) }), terminal: term, exchangeAddress: ADDR.exchange, now: () => T0, log: () => {} });
    expect(db.withdrawals.get(id)!.status).toBe('settled');
  });

  it('сумма не та → needs_review, без авто-возврата', async () => {
    const { db, term, pool } = setup();
    const id = await sentWithdrawal(db, term, ADDR.other, 4999);
    const before = term.calls.length;
    await runTick({ pool, chain: chain({ [H('5')]: solid('solid-payout-ok.json', H('5')) }), terminal: term, exchangeAddress: ADDR.exchange, now: () => T0, log: () => {} });
    expect(db.withdrawals.get(id)).toMatchObject({ status: 'needs_review' });
    expect(db.withdrawals.get(id)!.review_reason).toMatch(/сумма/);
    expect(term.calls.length).toBe(before);
  });
});
