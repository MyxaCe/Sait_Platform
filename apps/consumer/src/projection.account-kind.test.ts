import { describe, expect, it } from 'vitest';
import { applyTerminalEvent, classifyMessage, type Querier } from './projection.js';

/**
 * Демо и реальный счёт разделены (09.11). Событие без `accountKind` —
 * старое — идёт в demo_* прежним путём; `real` — только в real_*; у real
 * свой accountSeq. Причина изменения баланса разбирается терпимо.
 */

function fakeDb(opts: { realRowCount?: number } = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db: Querier = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('INSERT INTO real_accounts') && sql.includes('WHERE EXCLUDED.account_seq')) {
        return { rows: [], rowCount: opts.realRowCount ?? 1 };
      }
      return { rows: [], rowCount: 1 };
    },
  };
  return { db, calls };
}

const cfg = { tenant: 'apex-ru', newId: () => '00000000-0000-0000-0000-000000000000' };

function event(name: string, data: Record<string, unknown>) {
  const r = classifyMessage({
    event_id: crypto.randomUUID(),
    event: name,
    version: 1,
    occurred_at: '2026-11-09T10:00:00.000Z',
    source: 'terminal',
    data: { tenant: 'apex-ru', userId: 'u1', ...data },
  });
  if (r.kind !== 'terminal-event') throw new Error(`ожидалось событие, а не ${r.kind}`);
  return r.event;
}

const tables = (calls: { sql: string }[]) =>
  calls.map((c) => /(demo|real)_(accounts|positions|trades)/.exec(c.sql)?.[0]).filter(Boolean);

describe('проекция по счёту', () => {
  it('без accountKind (старое событие) — только demo_*', async () => {
    const { db, calls } = fakeDb();
    await applyTerminalEvent(db, 'e1', event('terminal.balance.changed', { balanceCents: 900000, positions: [] }), cfg);
    expect(tables(calls).every((t) => t!.startsWith('demo_'))).toBe(true);
    expect(tables(calls)).toContain('demo_accounts');
  });

  it('accountKind=real — только real_*, ни одного demo_*', async () => {
    const { db, calls } = fakeDb();
    await applyTerminalEvent(
      db,
      'e2',
      event('terminal.balance.changed', {
        balanceCents: 15000,
        accountKind: 'real',
        accountId: 'acc-r1',
        accountSeq: 3,
        reason: 'deposit',
        positions: [{ symbol: 'BTCUSD', side: 'buy', volume: 0.01, entryPrice: 90000 }],
      }),
      cfg,
    );
    expect(tables(calls)).toEqual(['real_accounts', 'real_positions', 'real_positions']);
    const upsert = calls.find((c) => c.sql.includes('INSERT INTO real_accounts'))!;
    expect(upsert.params).toEqual(['u1', 'acc-r1', 15000, null, 3]);
  });

  it('real: устаревший accountSeq → skipped-stale (у real свой номер)', async () => {
    const { db } = fakeDb({ realRowCount: 0 });
    const out = await applyTerminalEvent(
      db,
      'e3',
      event('terminal.balance.changed', { balanceCents: 1, accountKind: 'real', accountSeq: 1 }),
      cfg,
    );
    expect(out).toBe('skipped-stale');
  });

  it('real: сделка — в real_trades; уведомление о сбросе только для демо', async () => {
    const { db, calls } = fakeDb();
    await applyTerminalEvent(
      db,
      'e4',
      event('terminal.trade.executed', {
        accountKind: 'real',
        tradeId: 't1',
        symbol: 'EURUSD',
        side: 'buy',
        volume: 0.1,
        price: 1.08,
        executedAt: '2026-11-09T10:00:00.000Z',
      }),
      cfg,
    );
    expect(tables(calls)).toEqual(['real_trades']);

    const r = fakeDb();
    await applyTerminalEvent(
      r.db,
      'e5',
      event('terminal.balance.changed', { balanceCents: 0, accountKind: 'real', reason: 'reset' }),
      cfg,
    );
    expect(r.calls.some((c) => c.sql.includes("'demoReset'"))).toBe(false);
  });

  it('real account.opened: account_uuid сохраняется', async () => {
    const { db, calls } = fakeDb();
    await applyTerminalEvent(
      db,
      'e6',
      event('terminal.account.opened', { accountKind: 'real', accountId: 'acc-r1', currency: 'USD', balanceCents: 0 }),
      cfg,
    );
    const ins = calls.find((c) => c.sql.includes('INSERT INTO real_accounts'))!;
    expect(ins.params.slice(0, 2)).toEqual(['u1', 'acc-r1']);
  });
});

describe('разбор: терпимость и строгость', () => {
  it("reason 'withdrawal' принимается", () => {
    const e = event('terminal.balance.changed', { balanceCents: 1, reason: 'withdrawal' });
    expect(e.name === 'terminal.balance.changed' && e.data.reason).toBe('withdrawal');
  });

  it('незнакомый reason → null, событие НЕ роняется', () => {
    const e = event('terminal.balance.changed', { balanceCents: 1, reason: 'bonus_campaign' });
    expect(e.name === 'terminal.balance.changed' && e.data.reason).toBeNull();
  });

  it('незнакомый accountKind — malformed, а не «демо по умолчанию»', () => {
    const r = classifyMessage({
      event_id: crypto.randomUUID(),
      event: 'terminal.balance.changed',
      version: 1,
      occurred_at: '2026-11-09T10:00:00.000Z',
      source: 'terminal',
      data: { tenant: 'apex-ru', userId: 'u1', balanceCents: 1, accountKind: 'vip' },
    });
    expect(r.kind).toBe('malformed');
  });
});
