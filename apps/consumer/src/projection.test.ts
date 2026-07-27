import { describe, expect, it } from 'vitest';
import { applyTerminalEvent, parseMessage, type Querier } from './projection.js';

/** Фейковый Querier: пишет вызовы в лог, эмулирует ON CONFLICT дедупа. */
function fakeDb() {
  const calls: { sql: string; params: unknown[] }[] = [];
  const claimed = new Set<string>();
  const db: Querier = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('INSERT INTO processed_events')) {
        const id = String(params[0]);
        if (claimed.has(id)) return { rows: [], rowCount: 0 };
        claimed.add(id);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
  };
  return { db, calls };
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

describe('parseMessage', () => {
  it('валидное событие терминала разбирается', () => {
    const parsed = parseMessage(
      envelope('terminal.balance.changed', { tenant: 'apex-ru', userId: 'u1', balanceCents: 900000 }),
    );
    expect(parsed?.name).toBe('terminal.balance.changed');
  });

  it('неизвестный event и мусор → null', () => {
    expect(parseMessage(envelope('terminal.unknown', { tenant: 'apex-ru', userId: 'u1' }))).toBeNull();
    expect(parseMessage({ garbage: true })).toBeNull();
    expect(parseMessage(envelope('terminal.balance.changed', { tenant: 'apex-ru' }))).toBeNull();
  });
});

describe('applyTerminalEvent', () => {
  it('balance.changed обновляет баланс и заменяет позиции', async () => {
    const { db, calls } = fakeDb();
    const ev = parseMessage(
      envelope('terminal.balance.changed', {
        tenant: 'apex-ru',
        userId: 'u1',
        balanceCents: 880000,
        positions: [{ symbol: 'BTCUSD', side: 'buy', volume: 0.1, entryPrice: 65000 }],
      }),
    )!;
    const outcome = await applyTerminalEvent(db, 'e1', ev, cfg);
    expect(outcome).toBe('applied');
    expect(calls.some((c) => c.sql.includes('UPDATE demo_accounts SET balance_cents'))).toBe(true);
    expect(calls.some((c) => c.sql.includes('DELETE FROM demo_positions'))).toBe(true);
    expect(calls.some((c) => c.sql.includes('INSERT INTO demo_positions'))).toBe(true);
  });

  it('дубликат по event_id пропускается', async () => {
    const { db } = fakeDb();
    const ev = parseMessage(
      envelope('terminal.balance.changed', { tenant: 'apex-ru', userId: 'u1', balanceCents: 900000 }),
    )!;
    expect(await applyTerminalEvent(db, 'dup', ev, cfg)).toBe('applied');
    expect(await applyTerminalEvent(db, 'dup', ev, cfg)).toBe('skipped-duplicate');
  });

  it('чужой тенант пропускается', async () => {
    const { db } = fakeDb();
    const ev = parseMessage(
      envelope('terminal.balance.changed', { tenant: 'other-site', userId: 'u1', balanceCents: 1 }),
    )!;
    expect(await applyTerminalEvent(db, 'e2', ev, cfg)).toBe('skipped-tenant');
  });

  it('trade.executed пишет сделку и уведомление', async () => {
    const { db, calls } = fakeDb();
    const ev = parseMessage(
      envelope('terminal.trade.executed', {
        tenant: 'apex-ru',
        userId: 'u1',
        tradeId: 't1',
        symbol: 'ETHUSD',
        side: 'sell',
        volume: 1,
        price: 1900,
        executedAt: '2026-07-27T10:00:00.000Z',
      }),
    )!;
    expect(await applyTerminalEvent(db, 'e3', ev, cfg)).toBe('applied');
    expect(calls.some((c) => c.sql.includes('INSERT INTO demo_trades'))).toBe(true);
    expect(calls.some((c) => c.sql.includes("'tradeExecuted'"))).toBe(true);
  });
});
