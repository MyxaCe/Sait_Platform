import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, seedOperator, seedUser, type TestDb } from '@broker/support/testing';

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('./db', () => ({ getPool: () => holder.db }));

const { listMyDeposits } = await import('./money');

let db: TestDb;
let client: string;
let other: string;
let admin: string;

async function command(userId: string, state: string, amountMinor: number, executedAt: string | null) {
  await db.query(
    `INSERT INTO money_commands (type, account_id, amount_minor, currency, scale, initiator_id, initiator_role,
                                 basis_ref, nonce, state, executed_at)
     VALUES ('credit', $1, $2, 'USDT', 2, $3, 'admin', 'банковский перевод', $4, $5, $6)`,
    [userId, amountMinor, admin, crypto.randomUUID(), state, executedAt],
  );
}

beforeEach(async () => {
  db = await createTestDb();
  holder.db = db;
  client = await seedUser(db);
  other = await seedUser(db);
  admin = await seedOperator(db, 'admin');
});
afterEach(async () => db.close());

describe('история операций кабинета: зачисление администрацией', () => {
  it('исполненное ручное зачисление — в ленте пополнений с пометкой источника; прочие — нет', async () => {
    await db.query(
      `INSERT INTO crypto_deposits (user_id, tx_hash, status, amount_minor, claimed_at)
       VALUES ($1, $2, 'credited', 1000, '2026-11-10T10:00:00Z')`,
      [client, 'a'.repeat(64)],
    );
    await command(client, 'executed', 25_000, '2026-11-19T10:00:00Z');
    await command(client, 'awaiting_second_approval', 5_000, null);
    await command(client, 'rejected', 7_000, null);
    await command(other, 'executed', 9_000, '2026-11-19T11:00:00Z');

    const list = await listMyDeposits(client);
    expect(list.map((d) => [d.source, d.status, d.amountMinor])).toEqual([
      ['admin', 'credited', 25_000],
      ['chain', 'credited', 1000],
    ]);
  });

  it('подпись типа операции есть в обоих каталогах', () => {
    const read = (l: string) => JSON.parse(readFileSync(path.resolve(__dirname, `../messages/${l}.json`), 'utf8'));
    expect(read('ru').money.opAdminCredit).toBe('Зачисление администрацией');
    expect(read('en').money.opAdminCredit).toBeTruthy();
  });
});
