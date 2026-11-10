import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import type { FeesOutcome, TerminalFeesClient } from '@broker/money';
import { changePortfolioFees, type FeesSync } from './portfolio-fees';

/**
 * Тариф портфеля: журнал той же транзакцией, доставка всем клиентам портфеля,
 * fail-closed (отказ/недоступность терминала → ROLLBACK + откат применённого).
 */

const OP = '11111111-1111-1111-1111-111111111111';

function fakePool(initial = { markup_bps: 0, commission_bps: 0, instruments: null as string | null, description: null as string | null }) {
  const state = { ...initial };
  const journal: { action: string; payload: string; entry_hash: string }[] = [];
  const flags = { committed: false, rolledBack: false };
  const client = {
    async query(sql: string, params: unknown[] = []) {
      if (/^BEGIN/i.test(sql)) return { rows: [] };
      if (/^ROLLBACK/i.test(sql)) return (flags.rolledBack = true), { rows: [] };
      if (/^COMMIT/i.test(sql)) return (flags.committed = true), { rows: [] };
      if (/SELECT markup_bps, commission_bps, instruments, description FROM leverage_portfolios/i.test(sql)) {
        return { rows: params[0] === 'standard' ? [{ ...state }] : [] };
      }
      if (/UPDATE leverage_portfolios/i.test(sql)) {
        Object.assign(state, { markup_bps: params[1], commission_bps: params[2], instruments: params[3], description: params[4] });
        return { rows: [] };
      }
      if (/pg_advisory_xact_lock/i.test(sql)) return { rows: [{}] };
      if (/SELECT entry_hash FROM admin_action_journal/i.test(sql)) {
        const last = journal[journal.length - 1];
        return { rows: last ? [{ entry_hash: last.entry_hash }] : [] };
      }
      if (/INSERT INTO admin_action_journal/i.test(sql)) {
        journal.push({ action: params[2] as string, payload: params[5] as string, entry_hash: params[7] as string });
        return { rows: [] };
      }
      if (/SELECT seq FROM admin_action_journal WHERE entry_hash/i.test(sql)) {
        const i = journal.findIndex((r) => r.entry_hash === params[0]);
        return { rows: i >= 0 ? [{ seq: i + 1 }] : [] };
      }
      throw new Error(`неожиданный SQL: ${sql}`);
    },
    release() {},
  };
  return { pool: { connect: async () => client as unknown as PoolClient }, state, journal, flags };
}

function terminal(script: FeesOutcome['state'][]) {
  const calls: { userId: string; kind: string; markup: number; reason: string }[] = [];
  const current = new Map<string, { markupBps: number; commissionBps: number }>();
  const client: TerminalFeesClient = {
    async setFees(userId, body, kind) {
      calls.push({ userId, kind, markup: body.markup_bps, reason: body.reason });
      const mode = script.shift() ?? 'ok';
      if (mode === 'unavailable') return { state: 'unavailable', reason: 'network' };
      if (mode === 'refused') return { state: 'refused', code: 'invalid_fees', status: 400 };
      if (mode === 'not-opened') return { state: 'not-opened' };
      const key = `${userId}:${kind}`;
      const prev = current.get(key) ?? { markupBps: 0, commissionBps: 0 };
      const next = { markupBps: body.markup_bps, commissionBps: body.commission_bps };
      current.set(key, next);
      return { state: 'ok', fees: next, previous: prev, changed: prev.markupBps !== next.markupBps, seq: calls.length };
    },
  };
  return { client, calls };
}

const sync = (t: TerminalFeesClient, users = ['u1', 'u2']): FeesSync => ({ usersOfPortfolio: async () => users, terminal: t });
const input = { operatorId: OP, operatorLogin: 'i.kovaleva', portfolioKey: 'standard', markupBps: 15, commissionBps: 0, instruments: 'Крипто', description: null, reason: 'Решение владельца №6' };

describe('тариф портфеля', () => {
  it('без основания / ставка вне 0..500 — отказ до транзакции', async () => {
    const f = fakePool();
    const t = terminal([]);
    expect(await changePortfolioFees({ ...input, reason: ' ' }, f.pool, sync(t.client))).toEqual({ ok: false, reason: 'missingReason' });
    expect(await changePortfolioFees({ ...input, markupBps: 501 }, f.pool, sync(t.client))).toEqual({ ok: false, reason: 'invalidFees' });
    expect(t.calls).toHaveLength(0);
  });

  it('успех: портфель + журнал + оба счёта каждого клиента в терминале, COMMIT', async () => {
    const f = fakePool();
    const t = terminal([]);
    const r = await changePortfolioFees(input, f.pool, sync(t.client));
    expect(r).toMatchObject({ ok: true, clients: 2 });
    expect(t.calls.map((c) => `${c.userId}:${c.kind}`)).toEqual(['u1:demo', 'u1:real', 'u2:demo', 'u2:real']);
    expect(f.journal.map((j) => j.action)).toEqual(['leverage.portfolio_fees_changed']);
    expect(JSON.parse(f.journal[0]!.payload).basis).toBe('Решение владельца №6');
    expect(f.flags.committed).toBe(true);
  });

  it('счёт не открыт — не ошибка (тариф приедет SSO-claim при входе)', async () => {
    const f = fakePool();
    const t = terminal(['not-opened', 'ok', 'ok', 'ok']);
    expect((await changePortfolioFees(input, f.pool, sync(t.client))).ok).toBe(true);
  });

  it('fail-closed: терминал не ответил на 3-м вызове → ROLLBACK и откат уже применённого', async () => {
    const f = fakePool();
    const t = terminal(['ok', 'ok', 'unavailable']);
    const r = await changePortfolioFees(input, f.pool, sync(t.client));
    expect(r).toEqual({ ok: false, reason: 'terminalUnavailable' });
    expect(f.flags.rolledBack).toBe(true);
    expect(f.flags.committed).toBe(false);
    const rollbacks = t.calls.filter((c) => c.reason.startsWith('откат'));
    expect(rollbacks.map((c) => `${c.userId}:${c.kind}:${c.markup}`)).toEqual(['u1:real:0', 'u1:demo:0']);
  });

  it('fail-closed: отказ терминала → terminalRefused с кодом, ROLLBACK', async () => {
    const f = fakePool();
    const t = terminal(['refused']);
    expect(await changePortfolioFees(input, f.pool, sync(t.client))).toEqual({ ok: false, reason: 'terminalRefused', code: 'invalid_fees' });
    expect(f.flags.rolledBack).toBe(true);
  });

  it('правка только текстов — терминал не зовём; без изменений — noChange', async () => {
    const f = fakePool({ markup_bps: 15, commission_bps: 0, instruments: null, description: null });
    const t = terminal([]);
    expect((await changePortfolioFees(input, f.pool, sync(t.client))).ok).toBe(true);
    expect(t.calls).toHaveLength(0);
    expect(await changePortfolioFees(input, f.pool, sync(t.client))).toEqual({ ok: false, reason: 'noChange' });
  });
});
