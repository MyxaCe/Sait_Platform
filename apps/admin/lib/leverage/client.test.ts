import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { FakeTerminal } from '@broker/money/testing';
import { setClientPortfolio, setClientOverride, clearClientOverride } from './client';
import type { LeverageTerminalSync } from './terminal-sync';

/**
 * WEB-44/46 · портфель клиента и override клиента по заявке (Р-446, Р-049).
 *
 * In-memory фейк ведёт себя как `client_leverage` + `admin_action_journal` в
 * одной транзакции. Проверяем: journaled кто/когда/основание/№ заявки,
 * приоритет override (пишется с ticket), снятие, fail-closed.
 */

const OP = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const CRYPTO_LEVERAGE: Record<string, number> = { standard: 10, pro: 50 };

interface Row {
  portfolio_key: string | null;
  override_leverage: number | null;
  override_reason: string | null;
  override_ticket: string | null;
  last_journal_seq: number | null;
}
interface JournalRow { seq: number; action: string; subject_id: string; payload: string; entry_hash: string }

function fakePool(opts: {
  userExists?: boolean;
  row?: Partial<Row> | null;
  defaultPortfolio?: string | null;
}) {
  const userExists = opts.userExists ?? true;
  const defaultPortfolio = opts.defaultPortfolio ?? 'standard';
  let row: Row | null = opts.row
    ? {
        portfolio_key: opts.row.portfolio_key ?? 'standard',
        override_leverage: opts.row.override_leverage ?? null,
        override_reason: opts.row.override_reason ?? null,
        override_ticket: opts.row.override_ticket ?? null,
        last_journal_seq: null,
      }
    : null;
  const journal: JournalRow[] = [];
  const flags = { committed: false, rolledBack: false, begun: false };

  const client = {
    async query(sql: string, params: unknown[] = []) {
      if (/^BEGIN/i.test(sql)) return (flags.begun = true), { rows: [] };
      if (/^ROLLBACK/i.test(sql)) return (flags.rolledBack = true), { rows: [] };
      if (/^COMMIT/i.test(sql)) return (flags.committed = true), { rows: [] };
      if (/SELECT 1 FROM users WHERE id/i.test(sql)) {
        return { rows: userExists ? [{ '?column?': 1 }] : [] };
      }
      if (/SELECT 1 FROM leverage_portfolios WHERE key/i.test(sql)) {
        return { rows: [{ '?column?': 1 }] };
      }
      if (/SELECT key FROM leverage_portfolios WHERE is_default/i.test(sql)) {
        return { rows: defaultPortfolio ? [{ key: defaultPortfolio }] : [] };
      }
      if (/SELECT portfolio_key FROM client_leverage/i.test(sql)) {
        return { rows: row ? [{ portfolio_key: row.portfolio_key }] : [] };
      }
      if (/SELECT portfolio_key, override_leverage FROM client_leverage/i.test(sql)) {
        return { rows: row ? [{ portfolio_key: row.portfolio_key, override_leverage: row.override_leverage }] : [] };
      }
      if (/SELECT override_leverage FROM client_leverage/i.test(sql)) {
        return { rows: row ? [{ override_leverage: row.override_leverage }] : [] };
      }
      if (/INSERT INTO client_leverage\s*\(user_id, portfolio_key, updated_at\)/i.test(sql)) {
        row = { portfolio_key: params[1] as string, override_leverage: row?.override_leverage ?? null,
          override_reason: row?.override_reason ?? null, override_ticket: row?.override_ticket ?? null,
          last_journal_seq: null };
        return { rows: [] };
      }
      if (/INSERT INTO client_leverage/i.test(sql)) {
        // override insert/upsert
        row = { portfolio_key: params[1] as string, override_leverage: params[2] as number,
          override_reason: params[3] as string, override_ticket: params[4] as string, last_journal_seq: null };
        return { rows: [] };
      }
      if (/UPDATE client_leverage\s+SET override_leverage = NULL/i.test(sql)) {
        if (row) { row.override_leverage = null; row.override_reason = null; row.override_ticket = null; }
        return { rows: [] };
      }
      if (/UPDATE client_leverage SET last_journal_seq/i.test(sql)) {
        if (row) row.last_journal_seq = params[1] as number;
        return { rows: [] };
      }
      if (/pg_advisory_xact_lock/i.test(sql)) return { rows: [{ pg_advisory_xact_lock: '' }] };
      if (/SELECT entry_hash FROM admin_action_journal/i.test(sql)) {
        const last = journal[journal.length - 1];
        return { rows: last ? [{ entry_hash: last.entry_hash }] : [] };
      }
      if (/INSERT INTO admin_action_journal/i.test(sql)) {
        const p = params as string[];
        journal.push({ seq: journal.length + 1, action: p[2]!, subject_id: p[4]!, payload: p[5]!, entry_hash: p[7]! });
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
  // Действующее плечо по закону Р-446 для терминала (класс crypto):
  // override клиента › крипто-планка портфеля (Standard 1:10) › база (Pro 1:50).
  const terminal = new FakeTerminal();
  const sync: LeverageTerminalSync = {
    terminal,
    usersOfPortfolio: async () => [USER],
    read: async (_db, ids) => {
      const lev = row?.override_leverage ?? CRYPTO_LEVERAGE[row?.portfolio_key ?? defaultPortfolio ?? 'standard']!;
      return new Map(ids.map((id) => [id, lev]));
    },
  };
  return { pool, journal, flags, getRow: () => row, terminal, sync };
}

describe('WEB-44 · портфель клиента', () => {
  it('назначение портфеля: журнал leverage.client_portfolio_set с diff', async () => {
    const f = fakePool({ row: { portfolio_key: 'standard' } });
    const res = await setClientPortfolio(
      { operatorId: OP, userId: USER, portfolioKey: 'pro', reason: 'апгрейд клиента' },
      f.pool,
      f.sync,
    );
    expect(res).toMatchObject({ ok: true });
    expect(f.getRow()!.portfolio_key).toBe('pro');
    expect(f.journal[0]!.action).toBe('leverage.client_portfolio_set');
    expect(JSON.parse(f.journal[0]!.payload)).toMatchObject({ previousPortfolio: 'standard', newPortfolio: 'pro' });
    expect(f.getRow()!.last_journal_seq).toBe(1);
  });

  it('первый раз (строки нет): previousPortfolio = null', async () => {
    const f = fakePool({ row: null });
    const res = await setClientPortfolio(
      { operatorId: OP, userId: USER, portfolioKey: 'pro', reason: 'первичное назначение' },
      f.pool,
      f.sync,
    );
    expect(res).toMatchObject({ ok: true });
    expect(JSON.parse(f.journal[0]!.payload).previousPortfolio).toBeNull();
  });

  it('тот же портфель — пустой переход, откат', async () => {
    const f = fakePool({ row: { portfolio_key: 'pro' } });
    const res = await setClientPortfolio(
      { operatorId: OP, userId: USER, portfolioKey: 'pro', reason: 'без изменений' },
      f.pool,
      f.sync,
    );
    expect(res).toEqual({ ok: false, reason: 'alreadyInState' });
    expect(f.flags.rolledBack).toBe(true);
  });

  it('нет клиента — noClient', async () => {
    const f = fakePool({ userExists: false });
    const res = await setClientPortfolio(
      { operatorId: OP, userId: USER, portfolioKey: 'pro', reason: 'есть' },
      f.pool,
      f.sync,
    );
    expect(res).toEqual({ ok: false, reason: 'noClient' });
  });
});

describe('WEB-46 · override клиента по заявке', () => {
  it('выдача: journaled с № заявки и основанием, priority над портфелем', async () => {
    const f = fakePool({ row: { portfolio_key: 'standard' } });
    const res = await setClientOverride(
      { operatorId: OP, userId: USER, leverage: 5, reason: 'VIP по заявке', ticket: 'RISK-77' },
      f.pool,
      f.sync,
    );
    expect(res).toMatchObject({ ok: true });
    expect(f.getRow()!.override_leverage).toBe(5);
    expect(f.getRow()!.override_ticket).toBe('RISK-77');
    expect(f.journal[0]!.action).toBe('leverage.override_set');
    expect(JSON.parse(f.journal[0]!.payload)).toMatchObject({ basis: 'VIP по заявке', ticket: 'RISK-77', newLeverage: 5 });
  });

  it('без № заявки — fail-closed (override «не тихо в базе»)', async () => {
    const f = fakePool({ row: { portfolio_key: 'standard' } });
    const res = await setClientOverride(
      { operatorId: OP, userId: USER, leverage: 5, reason: 'есть основание', ticket: '  ' },
      f.pool,
      f.sync,
    );
    expect(res).toEqual({ ok: false, reason: 'missingReason' });
    expect(f.flags.begun).toBe(false);
  });

  it('клиент без строки садится в портфель по умолчанию + override', async () => {
    const f = fakePool({ row: null, defaultPortfolio: 'standard' });
    const res = await setClientOverride(
      { operatorId: OP, userId: USER, leverage: 3, reason: 'по заявке', ticket: 'RISK-9' },
      f.pool,
      f.sync,
    );
    expect(res).toMatchObject({ ok: true });
    expect(f.getRow()!.portfolio_key).toBe('standard');
    expect(f.getRow()!.override_leverage).toBe(3);
  });

  it('снятие override: leverage.override_cleared, поля обнулены', async () => {
    const f = fakePool({ row: { portfolio_key: 'standard', override_leverage: 5 } });
    const res = await clearClientOverride({ operatorId: OP, userId: USER, reason: 'заявка закрыта' }, f.pool, f.sync);
    expect(res).toMatchObject({ ok: true });
    expect(f.getRow()!.override_leverage).toBeNull();
    expect(f.journal[0]!.action).toBe('leverage.override_cleared');
    expect(JSON.parse(f.journal[0]!.payload).previousOverride).toBe(5);
  });

  it('снимать нечего — noOverride, откат', async () => {
    const f = fakePool({ row: { portfolio_key: 'standard', override_leverage: null } });
    const res = await clearClientOverride({ operatorId: OP, userId: USER, reason: 'нет override' }, f.pool, f.sync);
    expect(res).toEqual({ ok: false, reason: 'noOverride' });
    expect(f.flags.rolledBack).toBe(true);
  });
});

describe('Р-446 · плечо клиента доезжает до терминала (fail-closed)', () => {
  it('плечо больше 1000 — invalidLeverage до транзакции (граница терминала)', async () => {
    const f = fakePool({ row: { portfolio_key: 'standard' } });
    const res = await setClientOverride(
      { operatorId: OP, userId: USER, leverage: 1001, reason: 'по заявке', ticket: 'RISK-4' },
      f.pool,
      f.sync,
    );
    expect(res).toEqual({ ok: false, reason: 'invalidLeverage' });
    expect(f.flags.begun).toBe(false);
    expect(f.terminal.leverageCalls).toHaveLength(0);
  });

  it('override: оба счёта получают плечо override, журнал знает, что уехало', async () => {
    const f = fakePool({ row: { portfolio_key: 'standard' } });
    const res = await setClientOverride(
      { operatorId: OP, operatorLogin: 'risk', userId: USER, leverage: 5, reason: 'по заявке', ticket: 'RISK-1' },
      f.pool,
      f.sync,
    );
    expect(res).toMatchObject({ ok: true });
    expect(f.terminal.leverageCalls.map((c) => `${c.kind}:${c.leverage}`)).toEqual(['demo:5', 'real:5']);
    expect(JSON.parse(f.journal[0]!.payload).terminalLeverage).toEqual([{ userId: USER, before: 10, after: 5 }]);
    expect(f.flags.committed).toBe(true);
  });

  it('смена портфеля: Standard (крипта 1:10) → Pro (1:50)', async () => {
    const f = fakePool({ row: { portfolio_key: 'standard' } });
    const res = await setClientPortfolio(
      { operatorId: OP, userId: USER, portfolioKey: 'pro', reason: 'апгрейд' },
      f.pool,
      f.sync,
    );
    expect(res).toMatchObject({ ok: true });
    expect(f.terminal.leverageCalls.map((c) => c.leverage)).toEqual([50, 50]);
  });

  it('смена портфеля при override: действующее плечо то же — терминал не зовётся', async () => {
    const f = fakePool({ row: { portfolio_key: 'standard', override_leverage: 5 } });
    const res = await setClientPortfolio(
      { operatorId: OP, userId: USER, portfolioKey: 'pro', reason: 'апгрейд' },
      f.pool,
      f.sync,
    );
    expect(res).toMatchObject({ ok: true });
    expect(f.terminal.leverageCalls).toHaveLength(0);
  });

  it('снятие override возвращает плечо портфеля', async () => {
    const f = fakePool({ row: { portfolio_key: 'standard', override_leverage: 5 } });
    const res = await clearClientOverride({ operatorId: OP, userId: USER, reason: 'закрыта' }, f.pool, f.sync);
    expect(res).toMatchObject({ ok: true });
    expect(f.terminal.leverageCalls.map((c) => c.leverage)).toEqual([10, 10]);
  });

  it('терминал отказал — override НЕ выдан: откат, журнал не закоммичен, код наружу', async () => {
    const f = fakePool({ row: { portfolio_key: 'standard' } });
    f.terminal.next = ['invalid_leverage'];
    const res = await setClientOverride(
      { operatorId: OP, userId: USER, leverage: 7, reason: 'по заявке', ticket: 'RISK-2' },
      f.pool,
      f.sync,
    );
    expect(res).toEqual({ ok: false, reason: 'terminalRefused', code: 'invalid_leverage' });
    expect(f.flags.rolledBack).toBe(true);
    expect(f.flags.committed).toBe(false);
  });

  it('реальный счёт не ответил после демо — демо откатывается обратно', async () => {
    const f = fakePool({ row: { portfolio_key: 'standard' } });
    f.terminal.next = ['ok', 'unavailable'];
    const res = await setClientOverride(
      { operatorId: OP, userId: USER, leverage: 5, reason: 'по заявке', ticket: 'RISK-3' },
      f.pool,
      f.sync,
    );
    expect(res).toEqual({ ok: false, reason: 'terminalUnavailable' });
    expect(f.terminal.leverage.get(`${USER}:demo`)).toBe(20); // плечо «до» терминала
    expect(f.flags.committed).toBe(false);
  });
});
