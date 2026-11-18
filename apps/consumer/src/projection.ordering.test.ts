import type { ParsedTerminalEvent } from '@broker/api-client';
import { describe, expect, it } from 'vitest';
import {
  applyTerminalEvent,
  BalanceAccountMissingError,
  classifyMessage,
  type Querier,
} from './projection.js';

function fakeDb() {
  const accounts = new Map<string, { balance: number; seq: number | null }>();
  const processed = new Set<string>();
  const notifications: unknown[][] = [];

  const db: Querier = {
    async query(sql, params = []) {
      if (sql.includes('INSERT INTO processed_events')) {
        const id = String(params[0]);
        if (processed.has(id)) return { rows: [], rowCount: 0 };
        processed.add(id);
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes('INSERT INTO demo_accounts')) {
        const userId = String(params[0]);
        const balance = Number(params[1]);
        const seq = params[3] === undefined || params[3] === null ? null : Number(params[3]);
        const prev = accounts.get(userId);
        accounts.set(userId, { balance, seq: seq ?? prev?.seq ?? null });
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes('UPDATE demo_accounts')) {
        const guarded = sql.includes('account_seq');
        const balance = Number(params[0]);
        const seq = guarded
          ? params[1] === undefined || params[1] === null
            ? null
            : Number(params[1])
          : null;
        const userId = String(guarded ? params[2] : params[1]);

        const row = accounts.get(userId);
        if (!row) return { rows: [], rowCount: 0 };

        const pass = !guarded || seq === null || row.seq === null || row.seq < seq;
        if (!pass) return { rows: [], rowCount: 0 };

        row.balance = balance;
        if (guarded) row.seq = seq ?? row.seq;
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes('SELECT 1 FROM demo_accounts')) {
        const has = accounts.has(String(params[0]));
        return { rows: has ? [{ ok: 1 }] : [], rowCount: has ? 1 : 0 };
      }

      if (sql.includes('INSERT INTO notifications')) {
        notifications.push(params);
        return { rows: [], rowCount: 1 };
      }

      return { rows: [], rowCount: 1 };
    },
  };

  return { db, accounts, notifications };
}

const cfg = { tenant: 'apex-ru', newId: () => '00000000-0000-0000-0000-000000000000' };

function envelope(event: string, data: unknown, eventId = crypto.randomUUID()) {
  return {
    event_id: eventId,
    event,
    version: 1,
    occurred_at: '2026-07-27T10:00:00.000Z',
    source: 'terminal',
    data,
  };
}

function balance(data: Record<string, unknown>, eventId = crypto.randomUUID()) {
  const r = classifyMessage(envelope('terminal.balance.changed', { tenant: 'apex-ru', ...data }, eventId));
  if (r.kind !== 'terminal-event') throw new Error(`ожидалось событие, а не ${r.kind}`);
  return { eventId: r.eventId, event: r.event as ParsedTerminalEvent };
}

function apply(db: Querier, b: { eventId: string; event: ParsedTerminalEvent }) {
  return applyTerminalEvent(db, b.eventId, b.event, cfg);
}

async function open(db: Querier, userId: string, balanceCents = 1_000_000) {
  const r = classifyMessage(
    envelope('terminal.account.opened', { tenant: 'apex-ru', userId, currency: 'USD', balanceCents }),
  );
  if (r.kind !== 'terminal-event') throw new Error(`ожидалось событие, а не ${r.kind}`);
  await applyTerminalEvent(db, r.eventId, r.event as ParsedTerminalEvent, cfg);
}

describe('WEB-43 · перезапись остатка только при строго большем accountSeq', () => {
  it('свежее по accountSeq побеждает, даже когда применено ПОСЛЕ устаревшего', async () => {
    const { db, accounts } = fakeDb();
    await open(db, 'u1');
    await apply(db, balance({ userId: 'u1', balanceCents: 998700, accountSeq: 6 }));
    const outcome = await apply(db, balance({ userId: 'u1', balanceCents: 1005000, accountSeq: 5 }));

    expect(accounts.get('u1')?.balance).toBe(998700);
    expect(outcome).toBe('skipped-stale');
  });

  it('равный accountSeq НЕ перезаписывает (строго больший, не ≤ — иначе съели бы соседей по пачке)', async () => {
    const { db, accounts } = fakeDb();
    await open(db, 'u1');
    await apply(db, balance({ userId: 'u1', balanceCents: 100, accountSeq: 5 }));
    const outcome = await apply(db, balance({ userId: 'u1', balanceCents: 200, accountSeq: 5 }));

    expect(accounts.get('u1')?.balance).toBe(100);
    expect(outcome).toBe('skipped-stale');
  });

  it('устаревание ≠ отсутствие счёта: старое событие ОТБРАСЫВАЕТСЯ, а не бросает (WEB-29 не воскрешаем)', async () => {
    const { db } = fakeDb();
    await open(db, 'u1');
    await apply(db, balance({ userId: 'u1', balanceCents: 998700, accountSeq: 6 }));
    await expect(apply(db, balance({ userId: 'u1', balanceCents: 1, accountSeq: 5 }))).resolves.toBe(
      'skipped-stale',
    );
  });

  it('отсутствие счёта по-прежнему бросает (деньги есть, строки нет — WEB-29)', async () => {
    const { db } = fakeDb();
    await expect(
      apply(db, balance({ userId: 'missing', balanceCents: 500, accountSeq: 9 })),
    ).rejects.toBeInstanceOf(BalanceAccountMissingError);
  });

  it('переходный период: событие БЕЗ accountSeq применяется и не затирает сохранённый номер (Р-277)', async () => {
    const { db, accounts } = fakeDb();
    await open(db, 'u1');
    await apply(db, balance({ userId: 'u1', balanceCents: 500, accountSeq: 7 }));
    const outcome = await apply(db, balance({ userId: 'u1', balanceCents: 600 }));

    expect(outcome).toBe('applied');
    expect(accounts.get('u1')?.balance).toBe(600);
    expect(accounts.get('u1')?.seq).toBe(7);
  });
});
