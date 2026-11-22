import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyTerminalEvent, classifyMessage, type Querier } from './projection.js';

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
    const result = classifyMessage(envelope('billing.invoice.issued', { anything: true }));
    expect(result.kind).toBe('foreign');
    if (result.kind === 'foreign') expect(result.event).toBe('billing.invoice.issued');
  });

  it('НАШ тип со сломанным payload → malformed, а НЕ foreign', () => {
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
    expect(calls.some((c) => c.sql.includes('UPDATE demo_accounts') && c.sql.includes('balance_cents'))).toBe(true);
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

  it('уведомление о сделке несёт ЦЕНУ, а не только символ и объём (CAB-08)', async () => {
    const { db, calls } = fakeDb();
    const ev = parsed(
      envelope('terminal.trade.executed', {
        tenant: 'apex-ru',
        userId: 'u1',
        tradeId: 't2',
        symbol: 'ETHUSD',
        side: 'sell',
        volume: 1,
        price: 1900,
        executedAt: '2026-07-27T10:00:00.000Z',
      }),
    )!;
    await applyTerminalEvent(db, 'e4', ev, cfg);

    const notification = calls.find((c) => c.sql.includes("'tradeExecuted'"));
    expect(notification, 'уведомление о сделке не создано вовсе').toBeDefined();

    const params = JSON.parse(String(notification?.params[2])) as Record<string, unknown>;

    expect(params.price, `в параметрах уведомления нет цены: ${JSON.stringify(params)}`).toBe(1900);
    expect(params.symbol).toBe('ETHUSD');
  });
});

describe('terminal.margin.called', () => {
  const event = (extra: Record<string, unknown> = {}) =>
    parsed(
      envelope('terminal.margin.called', {
        tenant: 'apex-ru',
        userId: 'u1',
        marginLevelPct: 97,
        stopOutLevelPct: 50,
        equityCents: 8071001,
        usedMarginCents: 8320619,
        ...extra,
      }),
    );

  it('событие распознаётся, а не пропускается как чужое', () => {
    expect(event()).not.toBeNull();
  });

  it('пишет уведомление с обоими уровнями и деньгами', async () => {
    const { db, calls } = fakeDb();
    expect(await applyTerminalEvent(db, 'm1', event()!, cfg)).toBe('applied');

    const notification = calls.find((c) => c.sql.includes("'marginCalled'"));
    expect(notification, 'уведомление о марже не создано').toBeDefined();

    const params = JSON.parse(String(notification?.params[2])) as Record<string, unknown>;
    expect(params).toEqual({
      marginLevelPct: 97,
      stopOutLevelPct: 50,
      equityCents: 8071001,
      usedMarginCents: 8320619,
    });
  });

  it('порога нет → `null`, а не ноль', async () => {
    const { db, calls } = fakeDb();
    const ev = parsed(
      envelope('terminal.margin.called', {
        tenant: 'apex-ru',
        userId: 'u1',
        marginLevelPct: 97,
        equityCents: 100,
        usedMarginCents: 100,
      }),
    )!;
    await applyTerminalEvent(db, 'm2', ev, cfg);

    const notification = calls.find((c) => c.sql.includes("'marginCalled'"));
    const params = JSON.parse(String(notification?.params[2])) as Record<string, unknown>;

    expect(params.stopOutLevelPct).toBeNull();
    expect(params.stopOutLevelPct).not.toBe(0);
  });

  it('чужой тенант пропускается и здесь', async () => {
    const { db } = fakeDb();
    const ev = event({ tenant: 'other-site' })!;

    expect(await applyTerminalEvent(db, 'm3', ev, cfg)).toBe('skipped-tenant');
  });
});

describe('WEB-29 · баланс не теряется, когда счёта ещё нет', () => {
  function dbWithoutAccount() {
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
        if (sql.includes('UPDATE demo_accounts')) return { rows: [], rowCount: 0 };
        if (sql.includes('SELECT 1 FROM demo_accounts')) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 1 };
      },
    };
    return { db, calls };
  }

  const balanceEvent = parsed(
    envelope('terminal.balance.changed', {
      tenant: 'apex-ru',
      userId: 'u-нет-такого',
      balanceCents: 1234567,
    }),
  )!;

  it('ноль обновлённых строк — ОТКАЗ, а не applied', async () => {
    const { db } = dbWithoutAccount();

    await expect(applyTerminalEvent(db, 'ev-1', balanceEvent, cfg)).rejects.toThrow(
      /не записан/,
    );
  });

  it('в отказе названы пользователь и событие', async () => {
    const { db } = dbWithoutAccount();

    await expect(applyTerminalEvent(db, 'ev-2', balanceEvent, cfg)).rejects.toThrow(
      /u-нет-такого[\s\S]*ev-2|ev-2[\s\S]*u-нет-такого/,
    );
  });

  it('когда строка есть — обычный applied, отказ не мешает работе', async () => {
    const { db } = fakeDb();

    expect(await applyTerminalEvent(db, 'ev-3', balanceEvent, cfg)).toBe('applied');
  });

  it('повторная доставка возможна: заявку на дедуп уносит откат транзакции', async () => {
    const index = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

    expect(index).toContain("client.query('BEGIN')");
    expect(index).toContain("client.query('ROLLBACK')");
    expect(index).toMatch(/catch[\s\S]*ROLLBACK/);
  });
});

describe('WEB-20 · уровень и разрыв доезжают в уведомление честно', () => {
  const trade = (extra: Record<string, unknown> = {}) =>
    parsed(
      envelope('terminal.trade.executed', {
        tenant: 'apex-ru',
        userId: 'u1',
        tradeId: 't-slip',
        symbol: 'EURUSD',
        side: 'sell',
        volume: 0.1,
        price: 1.082,
        executedAt: '2026-10-24T10:00:00.000Z',
        ...extra,
      }),
    )!;

  async function paramsOf(ev: ReturnType<typeof trade>, id: string) {
    const { db, calls } = fakeDb();
    await applyTerminalEvent(db, id, ev, cfg);
    const notification = calls.find((c) => c.sql.includes("'tradeExecuted'"));
    return JSON.parse(String(notification?.params[2])) as Record<string, unknown>;
  }

  it('уровень и разрыв доезжают, когда они есть', async () => {
    const params = await paramsOf(trade({ level: 1.085, acrossGap: true }), 's1');

    expect(params.level).toBe(1.085);
    expect(params.acrossGap).toBe(true);
  });

  it('уровня нет → `null`, а НЕ ноль', async () => {
    const params = await paramsOf(trade(), 's2');

    expect(params.level).toBeNull();
    expect(params.level).not.toBe(0);
  });

  it('разрыв неизвестен → `null`, а не `false`', async () => {
    const params = await paramsOf(trade(), 's3');

    expect(params.acrossGap).toBeNull();
  });

  it('«проверяли, не было» сохраняется как `false`, а не теряется', async () => {
    const params = await paramsOf(trade({ acrossGap: false }), 's4');

    expect(params.acrossGap).toBe(false);
  });
});

describe('шаг 2 · денежная тройка в проекции', () => {
  function balanceWritten(calls: { sql: string; params: unknown[] }[]): unknown {
    const call = calls.find((c) => c.sql.includes('UPDATE demo_accounts') && c.sql.includes('balance_cents'));
    if (!call) throw new Error('проекция не трогала баланс');
    return call.params[0];
  }

  it('событие с тройкой разбирается и применяется', async () => {
    const { db, calls } = fakeDb();
    const ev = parsed(
      envelope('terminal.balance.changed', {
        tenant: 'apex-ru',
        userId: 'u1',
        balanceCents: 880000,
        balanceMinor: 880000,
        currency: 'USD',
        currencyMinorUnits: 2,
      }),
    )!;

    expect(await applyTerminalEvent(db, 'm1', ev, cfg)).toBe('applied');
    expect(balanceWritten(calls)).toBe(880000);
  });

  it('тройки нет — старое поле ещё работает, событие не теряется', async () => {
    const { db, calls } = fakeDb();
    const ev = parsed(
      envelope('terminal.balance.changed', {
        tenant: 'apex-ru',
        userId: 'u1',
        balanceCents: 770000,
      }),
    )!;

    expect(await applyTerminalEvent(db, 'm3', ev, cfg)).toBe('applied');
    expect(balanceWritten(calls)).toBe(770000);
  });

  it('ЕДИНСТВЕННЫЙ наблюдатель: расхождение — отказ, а не выбор молча', async () => {
    const { db } = fakeDb();
    const ev = parsed(
      envelope('terminal.balance.changed', {
        tenant: 'apex-ru',
        userId: 'u1',
        balanceCents: 880000,
        balanceMinor: 123,
        currency: 'USD',
        currencyMinorUnits: 2,
      }),
    )!;

    await expect(applyTerminalEvent(db, 'm4', ev, cfg)).rejects.toThrow(/называют одну сумму/);
  });
});

describe('WEB-42 · сброс порождает уведомление ИЗ СОБЫТИЯ', () => {
  function resetNotification(calls: { sql: string; params: unknown[] }[]) {
    return calls.find((c) => c.sql.includes("'demoReset'"));
  }

  function balanceEvent(data: Record<string, unknown>) {
    return parsed(envelope('terminal.balance.changed', { tenant: 'apex-ru', userId: 'u1', ...data }))!;
  }

  it('причина `reset` → уведомление есть', async () => {
    const { db, calls } = fakeDb();

    expect(
      await applyTerminalEvent(db, 'r1', balanceEvent({ balanceCents: 1_000_000, reason: 'reset' }), cfg),
    ).toBe('applied');
    expect(resetNotification(calls)).toBeDefined();
  });

  it('и несёт сумму, которую применил ИСТОЧНИК', async () => {
    const { db, calls } = fakeDb();
    await applyTerminalEvent(db, 'r2', balanceEvent({ balanceCents: 777_000, reason: 'reset' }), cfg);

    const params = resetNotification(calls)?.params[2] as string;
    expect(JSON.parse(params)).toEqual({ balanceCents: 777_000 });
  });

  it('сумма берётся из ТРОЙКИ, когда она приехала', async () => {
    const { db, calls } = fakeDb();
    await applyTerminalEvent(
      db,
      'r3',
      balanceEvent({
        balanceCents: 880_000,
        balanceMinor: 880_000,
        currency: 'USD',
        currencyMinorUnits: 2,
        reason: 'reset',
      }),
      cfg,
    );

    const params = resetNotification(calls)?.params[2] as string;
    expect(JSON.parse(params)).toEqual({ balanceCents: 880_000 });
  });

  it.each([['trade'], ['deposit'], ['adjustment']])(
    'причина «%s» → уведомления НЕТ: о сделке оно уже есть, остальное было бы шумом',
    async (reason) => {
      const { db, calls } = fakeDb();
      await applyTerminalEvent(db, `n-${reason}`, balanceEvent({ balanceCents: 1, reason }), cfg);

      expect(resetNotification(calls)).toBeUndefined();
    },
  );

  it('причины нет вовсе → уведомления нет', async () => {
    const { db, calls } = fakeDb();
    await applyTerminalEvent(db, 'r5', balanceEvent({ balanceCents: 1 }), cfg);

    expect(resetNotification(calls)).toBeUndefined();
  });
});
