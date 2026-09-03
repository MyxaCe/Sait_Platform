import { describe, expect, it } from 'vitest';
import { applyTerminalEvent, classifyMessage, type Querier } from './projection.js';

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

/** Разбирает валидное событие (используется дальше в проекции). */
function parsed(raw: unknown) {
  const result = classifyMessage(raw);
  if (result.kind !== 'terminal-event') throw new Error(`ожидалось событие, а не ${result.kind}`);
  return result.event;
}

describe('classifyMessage · чужое и сломанное — РАЗНЫЕ исходы', () => {
  it('наше валидное событие → terminal-event', () => {
    const result = classifyMessage(
      envelope('terminal.balance.changed', {
        tenant: 'apex-ru',
        userId: 'u1',
        balanceCents: 900000,
      }),
    );
    expect(result.kind).toBe('terminal-event');
    if (result.kind === 'terminal-event') {
      expect(result.event.name).toBe('terminal.balance.changed');
    }
  });

  it('чужой тип события → foreign, а НЕ malformed', () => {
    // Пропускать правильно: сосед выкатил тип раньше нас. Шуметь тут нельзя,
    // иначе предупреждения обесценятся и в них утонет настоящая потеря
    const result = classifyMessage(envelope('billing.invoice.issued', { anything: true }));
    expect(result.kind).toBe('foreign');
    if (result.kind === 'foreign') expect(result.event).toBe('billing.invoice.issued');
  });

  it('НАШ тип со сломанным payload → malformed, а НЕ foreign', () => {
    // Ровно то, что терялось: тип наш, значит событие адресовано нам
    const result = classifyMessage(envelope('terminal.balance.changed', { tenant: 'apex-ru' }));
    expect(result.kind).toBe('malformed');
    if (result.kind === 'malformed') {
      expect(result.reason).toContain('payload');
      expect(result.reason).toContain('terminal.balance.changed');
    }
  });

  it('сломанный конверт → malformed с указанием места', () => {
    const result = classifyMessage({ garbage: true });
    expect(result.kind).toBe('malformed');
    if (result.kind === 'malformed') expect(result.reason).toContain('envelope');
  });

  it('malformed сохраняет event_id, когда он есть — иначе в DLQ нечего искать', () => {
    const id = '11111111-2222-3333-4444-555555555555';
    const broken = classifyMessage(envelope('terminal.balance.changed', { tenant: 'apex-ru' }, id));
    expect(broken.kind === 'malformed' && broken.eventId).toBe(id);
  });

  it('конверт без event_id → malformed с eventId null, но всё равно с причиной', () => {
    const result = classifyMessage({ event: 'terminal.balance.changed', data: {} });
    expect(result.kind).toBe('malformed');
    if (result.kind === 'malformed') {
      expect(result.eventId).toBeNull();
      expect(result.reason).toBeTruthy();
    }
  });

  it('лишнее неизвестное поле НЕ ломает разбор (потребитель парсит мягко)', () => {
    const raw = {
      ...envelope('terminal.balance.changed', {
        tenant: 'apex-ru',
        userId: 'u1',
        balanceCents: 900000,
        somethingNew: 'из будущей версии',
      }),
      unknown_envelope_field: 42,
    };
    expect(classifyMessage(raw).kind).toBe('terminal-event');
  });
});

describe('applyTerminalEvent', () => {
  it('balance.changed обновляет баланс и заменяет позиции', async () => {
    const { db, calls } = fakeDb();
    const ev = parsed(
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
    const ev = parsed(
      envelope('terminal.balance.changed', {
        tenant: 'apex-ru',
        userId: 'u1',
        balanceCents: 900000,
      }),
    )!;
    expect(await applyTerminalEvent(db, 'dup', ev, cfg)).toBe('applied');
    expect(await applyTerminalEvent(db, 'dup', ev, cfg)).toBe('skipped-duplicate');
  });

  it('чужой тенант пропускается', async () => {
    const { db } = fakeDb();
    const ev = parsed(
      envelope('terminal.balance.changed', { tenant: 'other-site', userId: 'u1', balanceCents: 1 }),
    )!;
    expect(await applyTerminalEvent(db, 'e2', ev, cfg)).toBe('skipped-tenant');
  });

  it('trade.executed пишет сделку и уведомление', async () => {
    const { db, calls } = fakeDb();
    const ev = parsed(
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
