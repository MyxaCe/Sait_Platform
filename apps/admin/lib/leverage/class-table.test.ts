import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { FakeTerminal } from '@broker/money/testing';
import { terminalLeverageOf } from '@broker/money';
import { setClassLeverageTable } from './portfolio';
import { describeTerminalLeverage } from './classes';
import type { LeverageTerminalSync } from './terminal-sync';

const OP = '11111111-1111-1111-1111-111111111111';
const CLIENT = '33333333-3333-3333-3333-333333333333';

function fakePool(initial: Record<string, number>) {
  const state = { base: 20, classes: { ...initial } };
  const journal: { action: string; payload: string; entry_hash: string; seq: number }[] = [];
  const flags = { begun: false, committed: false, rolledBack: false };
  const client = {
    async query(sql: string, params: unknown[] = []) {
      if (/^BEGIN/i.test(sql)) return (flags.begun = true), { rows: [] };
      if (/^ROLLBACK/i.test(sql)) return (flags.rolledBack = true), { rows: [] };
      if (/^COMMIT/i.test(sql)) return (flags.committed = true), { rows: [] };
      if (/SELECT 1 FROM leverage_portfolios WHERE key/i.test(sql)) return { rows: [{ '?column?': 1 }] };
      if (/SELECT instrument_class, leverage FROM leverage_portfolio_class_overrides/i.test(sql)) {
        return { rows: Object.entries(state.classes).map(([instrument_class, leverage]) => ({ instrument_class, leverage })) };
      }
      if (/INSERT INTO leverage_portfolio_class_overrides/i.test(sql)) {
        state.classes[params[1] as string] = params[2] as number;
        return { rows: [] };
      }
      if (/DELETE FROM leverage_portfolio_class_overrides/i.test(sql)) {
        delete state.classes[params[1] as string];
        return { rows: [] };
      }
      if (/pg_advisory_xact_lock/i.test(sql)) return { rows: [{ pg_advisory_xact_lock: '' }] };
      if (/SELECT entry_hash FROM admin_action_journal/i.test(sql)) {
        const last = journal[journal.length - 1];
        return { rows: last ? [{ entry_hash: last.entry_hash }] : [] };
      }
      if (/INSERT INTO admin_action_journal/i.test(sql)) {
        const p = params as string[];
        journal.push({ seq: journal.length + 1, action: p[2]!, payload: p[5]!, entry_hash: p[7]! });
        return { rows: [] };
      }
      if (/SELECT seq FROM admin_action_journal WHERE entry_hash/i.test(sql)) {
        const found = journal.find((r) => r.entry_hash === params[0]);
        return { rows: found ? [{ seq: found.seq }] : [] };
      }
      throw new Error(`unexpected sql: ${sql}`);
    },
    release() {},
  };
  const pool = { async connect() { return client as unknown as PoolClient; } };
  const terminal = new FakeTerminal();
  const sync: LeverageTerminalSync = {
    terminal,
    usersOfPortfolio: async () => [CLIENT],
    read: async (_db, ids) => {
      const t = terminalLeverageOf(
        { key: 'standard', title: 'Standard', baseLeverage: state.base, classOverrides: { ...state.classes } },
        null,
      );
      return new Map(ids.map((id) => [id, t]));
    },
  };
  return { pool, state, journal, flags, terminal, sync };
}

describe('плечо портфеля по категориям — одной формой', () => {
  it('задать форекс, снять крипто, остальное не трогать: одна запись журнала, таблица в терминал', async () => {
    const f = fakePool({ crypto: 10, metals: 40 });
    const res = await setClassLeverageTable(
      {
        operatorId: OP,
        portfolioKey: 'standard',
        table: { forex: 100, crypto: null, metals: 40, stocks: null, energy: null, indices: null },
        reason: 'плечо по категориям',
      },
      f.pool,
      f.sync,
    );
    expect(res).toMatchObject({ ok: true });
    expect(f.state.classes).toEqual({ forex: 100, metals: 40 });
    expect(f.journal).toHaveLength(1);
    expect(f.journal[0]!.action).toBe('leverage.class_table_changed');
    const payload = JSON.parse(f.journal[0]!.payload);
    expect(payload).toMatchObject({
      basis: 'плечо по категориям',
      previous: { crypto: 10, metals: 40 },
      next: { forex: 100, metals: 40 },
    });
    expect(f.terminal.leverageCalls.map((c) => [c.kind, c.leverage, c.base, c.classes])).toEqual([
      ['demo', 20, 20, { forex: 100, metals: 40 }],
      ['real', 20, 20, { forex: 100, metals: 40 }],
    ]);
    expect(f.flags.committed).toBe(true);
  });

  it('ничего не изменилось — пустой переход, откат', async () => {
    const f = fakePool({ crypto: 10 });
    const res = await setClassLeverageTable(
      { operatorId: OP, portfolioKey: 'standard', table: { crypto: 10, forex: null }, reason: 'то же' },
      f.pool,
      f.sync,
    );
    expect(res).toEqual({ ok: false, reason: 'alreadyInState' });
    expect(f.flags.rolledBack).toBe(true);
  });

  it('проверки до транзакции: основание, категория, плечо', async () => {
    const f = fakePool({});
    const base = { operatorId: OP, portfolioKey: 'standard' };
    expect(await setClassLeverageTable({ ...base, table: { forex: 10 }, reason: ' ' }, f.pool, f.sync)).toEqual({
      ok: false,
      reason: 'missingReason',
    });
    expect(await setClassLeverageTable({ ...base, table: { fx: 10 }, reason: 'r' }, f.pool, f.sync)).toEqual({
      ok: false,
      reason: 'invalidClass',
    });
    expect(await setClassLeverageTable({ ...base, table: { forex: 1001 }, reason: 'r' }, f.pool, f.sync)).toEqual({
      ok: false,
      reason: 'invalidLeverage',
    });
    expect(f.flags.begun).toBe(false);
  });

  it('терминал не ответил — откат всего', async () => {
    const f = fakePool({});
    f.terminal.next = ['unavailable'];
    const res = await setClassLeverageTable(
      { operatorId: OP, portfolioKey: 'standard', table: { forex: 100 }, reason: 'r' },
      f.pool,
      f.sync,
    );
    expect(res).toEqual({ ok: false, reason: 'terminalUnavailable' });
    expect(f.flags.committed).toBe(false);
  });

  it('подпись для оператора: база и категории по-русски', () => {
    expect(describeTerminalLeverage({ leverage: 10, base: 20, classes: { crypto: 10, forex: 100 } })).toBe(
      'база 1:20 · Форекс 1:100 · Криптовалюты 1:10',
    );
  });
});
