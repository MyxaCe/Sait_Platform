import { describe, expect, it } from 'vitest';
import {
  bindUnidentifiedDeposit,
  claimDeposit,
  creditClaimedDeposit,
  recordUnidentified,
  rejectClaimedDeposit,
} from './deposits';
import { FakeDb } from './testing/fake-db';
import { FakeTerminal } from './testing/fake-terminal';
import { SYSTEM_OPERATORS } from './system-operators';

const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);
const A = 'user-a';
const B = 'user-b';
const OP = 'op-1';

function setup() {
  const db = new FakeDb();
  db.clients.set(A, {});
  db.clients.set(B, {});
  return { db, term: new FakeTerminal() };
}

const transfer = (raw: bigint) => ({
  amountRaw: raw,
  fromAddress: 'TFrom',
  toAddress: 'TExchange',
  blockTime: new Date('2026-11-09T10:00:00Z'),
});

describe('заявка на депозит по хэшу', () => {
  it('хэш принят: claimed + журнал от системы-кабинета', async () => {
    const { db } = setup();
    const r = await claimDeposit(db, { userId: A, txHash: `0x${H1.toUpperCase()}` });

    expect(r).toMatchObject({ ok: true, fromUnidentified: false });
    const row = [...db.deposits.values()][0]!;
    expect(row).toMatchObject({ tx_hash: H1, status: 'claimed', user_id: A, last_journal_seq: 1 });
    expect(db.journal[0]).toMatchObject({ action: 'crypto.deposit.claimed', operator_id: SYSTEM_OPERATORS.cabinet });
  });

  it('тот же хэш дважды (тот же или другой клиент) — второй отказ, строка одна', async () => {
    const { db } = setup();
    await claimDeposit(db, { userId: A, txHash: H1 });
    expect(await claimDeposit(db, { userId: A, txHash: H1 })).toEqual({ ok: false, reason: 'alreadyClaimed' });
    expect(await claimDeposit(db, { userId: B, txHash: H1 })).toEqual({ ok: false, reason: 'alreadyClaimed' });
    expect(db.deposits.size).toBe(1);
    expect(db.journal).toHaveLength(1);
  });

  it('гонка двух заявок одного хэша — ровно одна выигрывает', async () => {
    const { db } = setup();
    const [r1, r2] = await Promise.all([
      claimDeposit(db, { userId: A, txHash: H1 }),
      claimDeposit(db, { userId: B, txHash: H1 }),
    ]);
    expect([r1.ok, r2.ok].filter(Boolean)).toHaveLength(1);
    expect(db.deposits.size).toBe(1);
    expect(db.journal.filter((j) => j.action === 'crypto.deposit.claimed')).toHaveLength(1);
  });

  it('неопознанное поступление становится заявкой клиента, если он ввёл хэш позже', async () => {
    const { db } = setup();
    await recordUnidentified(db, {
      txHash: H1,
      fromAddress: 'TFrom',
      toAddress: 'TExchange',
      amountRaw: 5_000_000n,
      blockTime: new Date(),
    });
    const r = await claimDeposit(db, { userId: A, txHash: H1 });
    expect(r).toMatchObject({ ok: true, fromUnidentified: true });
    expect([...db.deposits.values()][0]).toMatchObject({ status: 'claimed', user_id: A });
  });

  it('невалидный хэш и закрытая политика — отказ без записи', async () => {
    const { db } = setup();
    db.clients.set(A, { blocked: true });
    expect(await claimDeposit(db, { userId: A, txHash: 'xyz' })).toEqual({ ok: false, reason: 'invalidHash' });
    expect(await claimDeposit(db, { userId: A, txHash: H1 })).toEqual({
      ok: false,
      reason: 'policy',
      policyReasons: ['blocked'],
    });
    db.settings.deposit_requires_kyc = true;
    expect(await claimDeposit(db, { userId: B, txHash: H2 })).toMatchObject({
      reason: 'policy',
      policyReasons: ['kyc_required'],
    });
    expect(db.deposits.size).toBe(0);
    expect(db.journal).toHaveLength(0);
  });
});

describe('зачисление (наблюдатель)', () => {
  it('сумма → центы вниз, остаток записан, терминал tron:<hash>, credited + журнал', async () => {
    const { db, term } = setup();
    const c = await claimDeposit(db, { userId: A, txHash: H1 });
    const id = (c as { depositId: string }).depositId;

    const r = await creditClaimedDeposit(db, term, {
      depositId: id,
      transfer: transfer(25_123_456n),
      minDepositMinor: 1000,
    });

    expect(r).toEqual({ state: 'credited', amountMinor: 2512, dustRaw: 3456n });
    expect(term.calls).toEqual([{ op: 'deposit', userId: A, ref: `tron:${H1}`, amount: 2512 }]);
    expect(term.balances.get(A)).toBe(2512);
    expect(db.deposits.get(id)).toMatchObject({ status: 'credited', amount_minor: 2512, dust_raw: '3456' });
    const j = db.journal.at(-1)!;
    expect(j).toMatchObject({ action: 'crypto.deposit.credited', operator_id: SYSTEM_OPERATORS.chainWatcher });
    expect(j.payload).toMatchObject({ dustRaw: '3456', amountMinor: 2512, fromAddress: 'TFrom' });
  });

  it('второй проход по уже зачисленному — пропуск, денег не двигаем', async () => {
    const { db, term } = setup();
    const id = ((await claimDeposit(db, { userId: A, txHash: H1 })) as { depositId: string }).depositId;
    await creditClaimedDeposit(db, term, { depositId: id, transfer: transfer(20_000_000n), minDepositMinor: 0 });
    const again = await creditClaimedDeposit(db, term, {
      depositId: id,
      transfer: transfer(20_000_000n),
      minDepositMinor: 0,
    });
    expect(again).toEqual({ state: 'skipped' });
    expect(term.calls).toHaveLength(1);
    expect(term.balances.get(A)).toBe(2000);
  });

  it('терминал применил, но ответ потерян → заявка осталась claimed; повтор тем же ref не удваивает', async () => {
    const { db, term } = setup();
    const id = ((await claimDeposit(db, { userId: A, txHash: H1 })) as { depositId: string }).depositId;
    term.next = ['apply-then-unavailable'];
    expect(
      await creditClaimedDeposit(db, term, { depositId: id, transfer: transfer(20_000_000n), minDepositMinor: 0 }),
    ).toEqual({ state: 'terminal-unavailable' });
    expect(db.deposits.get(id)!.status).toBe('claimed');

    const r = await creditClaimedDeposit(db, term, {
      depositId: id,
      transfer: transfer(20_000_000n),
      minDepositMinor: 0,
    });
    expect(r).toMatchObject({ state: 'credited' });
    expect(term.balances.get(A)).toBe(2000); // ровно один раз
  });

  it('ниже минимума — rejected below_minimum, терминал не вызывался', async () => {
    const { db, term } = setup();
    const id = ((await claimDeposit(db, { userId: A, txHash: H1 })) as { depositId: string }).depositId;
    const r = await creditClaimedDeposit(db, term, {
      depositId: id,
      transfer: transfer(5_000_000n),
      minDepositMinor: 1000,
    });
    expect(r).toEqual({ state: 'rejected', reason: 'below_minimum' });
    expect(term.calls).toHaveLength(0);
    expect(db.deposits.get(id)).toMatchObject({ status: 'rejected', reject_reason: 'below_minimum' });
  });

  it('сеть опровергла — rejected с причиной, повторно не отклоняется', async () => {
    const { db } = setup();
    const id = ((await claimDeposit(db, { userId: A, txHash: H1 })) as { depositId: string }).depositId;
    expect(await rejectClaimedDeposit(db, { depositId: id, reason: 'wrong_recipient', toAddress: 'TOther' })).toBe(true);
    expect(db.deposits.get(id)).toMatchObject({ status: 'rejected', reject_reason: 'wrong_recipient', to_address: 'TOther' });
    expect(await rejectClaimedDeposit(db, { depositId: id, reason: 'failed' })).toBe(false);
  });
});

describe('неопознанные поступления', () => {
  const t = { txHash: H2, fromAddress: 'TFrom', toAddress: 'TEx', amountRaw: 12_340_000n, blockTime: new Date() };

  it('запись идемпотентна: второй раз — ничего', async () => {
    const { db } = setup();
    expect(await recordUnidentified(db, t)).toBe(true);
    expect(await recordUnidentified(db, t)).toBe(false);
    expect(db.deposits.size).toBe(1);
    expect(db.journal.filter((j) => j.action === 'crypto.deposit.unidentified')).toHaveLength(1);
  });

  it('уже заявленный хэш не превращается в неопознанный', async () => {
    const { db } = setup();
    await claimDeposit(db, { userId: A, txHash: H2 });
    expect(await recordUnidentified(db, t)).toBe(false);
    expect([...db.deposits.values()][0]!.status).toBe('claimed');
  });

  it('оператор привязывает с основанием → терминал, credited, журнал crypto.deposit.bound', async () => {
    const { db, term } = setup();
    await recordUnidentified(db, t);
    const id = [...db.deposits.keys()][0]!;
    const r = await bindUnidentifiedDeposit(db, term, {
      depositId: id,
      userId: B,
      operatorId: OP,
      operatorLogin: 'admin',
      reason: 'клиент прислал скрин перевода',
    });
    expect(r).toEqual({ ok: true, amountMinor: 1234 });
    expect(term.calls[0]).toMatchObject({ op: 'deposit', userId: B, ref: `tron:${H2}` });
    expect(db.deposits.get(id)).toMatchObject({ status: 'credited', user_id: B, resolved_by: OP });
    expect(db.journal.at(-1)).toMatchObject({ action: 'crypto.deposit.bound', operator_id: OP });

    // Повторная привязка (другому клиенту) невозможна.
    expect(
      await bindUnidentifiedDeposit(db, term, { depositId: id, userId: A, operatorId: OP, operatorLogin: 'a', reason: 'x' }),
    ).toEqual({ ok: false, reason: 'notUnidentified' });
    expect(term.calls).toHaveLength(1);
  });

  it('без основания / терминал недоступен — ничего не меняется', async () => {
    const { db, term } = setup();
    await recordUnidentified(db, t);
    const id = [...db.deposits.keys()][0]!;
    expect(
      await bindUnidentifiedDeposit(db, term, { depositId: id, userId: B, operatorId: OP, operatorLogin: 'a', reason: ' ' }),
    ).toEqual({ ok: false, reason: 'missingReason' });
    term.next = ['unavailable'];
    expect(
      await bindUnidentifiedDeposit(db, term, { depositId: id, userId: B, operatorId: OP, operatorLogin: 'a', reason: 'x' }),
    ).toEqual({ ok: false, reason: 'terminalUnavailable' });
    expect(db.deposits.get(id)).toMatchObject({ status: 'unidentified', user_id: null });
  });
});
