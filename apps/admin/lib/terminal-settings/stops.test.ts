import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StopsOutcome, TerminalStopsClient } from '@broker/money';
import { createTestDb, seedOperator, type TestDb } from '@broker/support/testing';
import { updateMinStop } from './stops';

/**
 * Минимальная дистанция SL/TP: сохранение = вызов терминала + журнал одной
 * транзакцией (PGlite, все миграции). Терминал не принял — журнала нет.
 */

class FakeStops implements TerminalStopsClient {
  value = 0;
  next: StopsOutcome | null = null;
  getFails = false;
  puts: number[] = [];
  async getMinStop(): Promise<StopsOutcome> {
    return this.getFails ? { state: 'unavailable', reason: 'network' } : { state: 'ok', minStopBps: this.value };
  }
  async setMinStop(n: number): Promise<StopsOutcome> {
    this.puts.push(n);
    if (this.next) return this.next;
    this.value = n;
    return { state: 'ok', minStopBps: n };
  }
}

let db: TestDb;
let admin: string;
let term: FakeStops;

async function journal() {
  const r = await db.query(
    `SELECT operator_id, subject_kind, subject_id, payload FROM admin_action_journal
      WHERE action = 'platform.terminal_stops.updated' ORDER BY seq`,
  );
  return r.rows;
}

beforeEach(async () => {
  db = await createTestDb();
  admin = await seedOperator(db, 'admin');
  term = new FakeStops();
});
afterEach(async () => {
  await db.close();
});

describe('минимальная дистанция SL/TP', () => {
  it('терминал принял → журнал до/после с основанием', async () => {
    expect(await updateMinStop({ operatorId: admin, reason: 'решение владельца', minStopBps: 10 }, db, term)).toMatchObject({
      ok: true,
      minStopBps: 10,
    });
    expect(term.puts).toEqual([10]);
    const j = await journal();
    expect(j).toHaveLength(1);
    expect(j[0]).toMatchObject({
      operator_id: admin,
      subject_kind: 'platform',
      subject_id: 'terminal_stops',
      payload: { basis: 'решение владельца', field: 'minStopBps', before: 0, after: 10 },
    });
  });

  it('терминал не ответил или отказал — ошибка, журнала нет', async () => {
    term.next = { state: 'unavailable', reason: 'network' };
    expect(await updateMinStop({ operatorId: admin, reason: 'x', minStopBps: 10 }, db, term)).toEqual({
      ok: false,
      reason: 'terminalUnavailable',
    });
    term.next = { state: 'refused', code: 'invalid_min_stop_bps', status: 400 };
    expect(await updateMinStop({ operatorId: admin, reason: 'x', minStopBps: 10 }, db, term)).toEqual({
      ok: false,
      reason: 'terminalRefused',
      code: 'invalid_min_stop_bps',
    });
    expect(await journal()).toHaveLength(0);
  });

  it('проверки до терминала: основание, диапазон, без изменений', async () => {
    expect(await updateMinStop({ operatorId: admin, reason: ' ', minStopBps: 10 }, db, term)).toEqual({ ok: false, reason: 'missingReason' });
    expect(await updateMinStop({ operatorId: admin, reason: 'x', minStopBps: 10_001 }, db, term)).toEqual({ ok: false, reason: 'invalidStopBps' });
    expect(await updateMinStop({ operatorId: admin, reason: 'x', minStopBps: Number.NaN }, db, term)).toEqual({ ok: false, reason: 'invalidStopBps' });
    expect(await updateMinStop({ operatorId: admin, reason: 'x', minStopBps: 0 }, db, term)).toEqual({ ok: false, reason: 'noChange' });
    expect(term.puts).toEqual([]);
  });

  it('чтение «до» не удалось — сохранение всё равно идёт, before = null', async () => {
    term.getFails = true;
    expect(await updateMinStop({ operatorId: admin, reason: 'x', minStopBps: 15 }, db, term)).toMatchObject({ ok: true });
    expect((await journal())[0]!.payload).toMatchObject({ before: null, after: 15 });
  });
});
