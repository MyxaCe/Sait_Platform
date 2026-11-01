import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';

// argon2 нативный тут не нужен — провижининг тестирует ЛОГИКУ и журнал, а не
// сам хеш; подменяем hashPassword на детерминированную строку.
vi.mock('../auth/password', () => ({
  hashPassword: vi.fn(async () => '$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA'),
}));

import { createOperator, disableOperator, changeOperatorRole } from './provision';

const ACTOR = '11111111-1111-1111-1111-111111111111';
const TARGET = '22222222-2222-2222-2222-222222222222';
const VALID_PASSWORD = 'correct horse battery';

interface JournalRow {
  action: string;
  subject_kind: string;
  subject_id: string;
  payload: string;
  entry_hash: string;
}

/** Фейк одной строки `operators` + журнала-массива в одной транзакции. */
function fakePool(opts: {
  row?: { role: string; login: string; disabledAt: string | null } | null;
  insertFails?: boolean;
}) {
  const row = opts.row === undefined ? { role: 'operator', login: 'j.doe', disabledAt: null } : opts.row;
  const journal: JournalRow[] = [];
  const flags = { begun: false, committed: false, rolledBack: false };
  let seq = 0;

  const client = {
    async query(sql: string, params: unknown[] = []) {
      if (/^BEGIN/i.test(sql)) return (flags.begun = true), { rows: [], rowCount: 0 };
      if (/^ROLLBACK/i.test(sql)) return (flags.rolledBack = true), { rows: [], rowCount: 0 };
      if (/^COMMIT/i.test(sql)) return (flags.committed = true), { rows: [], rowCount: 0 };
      if (/INSERT INTO operators/i.test(sql)) {
        if (opts.insertFails) throw Object.assign(new Error('dup'), { code: '23505' });
        return { rows: [{ id: TARGET }], rowCount: 1 };
      }
      if (/UPDATE operators\s+SET disabled_at/i.test(sql)) {
        if (!row || row.disabledAt !== null) return { rows: [], rowCount: 0 };
        row.disabledAt = 'now';
        return { rows: [{ login: row.login }], rowCount: 1 };
      }
      if (/SELECT role, login FROM operators/i.test(sql)) {
        return { rows: row ? [{ role: row.role, login: row.login }] : [], rowCount: row ? 1 : 0 };
      }
      if (/UPDATE operators SET role/i.test(sql)) {
        if (row) row.role = params[1] as string;
        return { rows: [], rowCount: 1 };
      }
      if (/pg_advisory_xact_lock/i.test(sql)) return { rows: [{ ok: '' }], rowCount: 1 };
      if (/SELECT entry_hash FROM admin_action_journal/i.test(sql)) {
        const last = journal[journal.length - 1];
        return { rows: last ? [{ entry_hash: last.entry_hash }] : [], rowCount: last ? 1 : 0 };
      }
      if (/INSERT INTO admin_action_journal/i.test(sql)) {
        const p = params as string[];
        seq += 1;
        journal.push({
          action: p[2]!,
          subject_kind: p[3]!,
          subject_id: p[4]!,
          payload: p[5]!,
          entry_hash: p[7]!,
        });
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`unexpected sql: ${sql}`);
    },
    release() {},
  };

  const pool = { async connect() { return client as unknown as PoolClient; } };
  return { pool, journal, flags, row };
}

describe('ADM-04 · createOperator', () => {
  it('создаёт оператора и пишет operator.created с основанием в журнал', async () => {
    const f = fakePool({});
    const res = await createOperator(
      { actorId: ACTOR, login: 'j.doe', displayName: 'John Doe', role: 'operator', password: VALID_PASSWORD, reason: 'новый аналитик' },
      f.pool,
    );
    expect(res).toEqual({ ok: true, operatorId: TARGET });
    expect(f.journal).toHaveLength(1);
    expect(f.journal[0]!.action).toBe('operator.created');
    expect(f.journal[0]!.subject_kind).toBe('operator');
    expect(f.journal[0]!.subject_id).toBe(TARGET);
    const payload = JSON.parse(f.journal[0]!.payload);
    expect(payload.basis).toBe('новый аналитик');
    expect(payload.role).toBe('operator');
    expect(f.flags.committed).toBe(true);
  });

  it('без основания — отказ, транзакция не начата (fail-closed)', async () => {
    const f = fakePool({});
    const res = await createOperator(
      { actorId: ACTOR, login: 'j.doe', displayName: 'John', role: 'operator', password: VALID_PASSWORD, reason: '  ' },
      f.pool,
    );
    expect(res).toEqual({ ok: false, reason: 'missingReason' });
    expect(f.flags.begun).toBe(false);
  });

  it('слабый пароль — отказ до транзакции', async () => {
    const f = fakePool({});
    const res = await createOperator(
      { actorId: ACTOR, login: 'j.doe', displayName: 'John', role: 'operator', password: 'short', reason: 'ок' },
      f.pool,
    );
    expect(res).toEqual({ ok: false, reason: 'weakPassword' });
    expect(f.flags.begun).toBe(false);
  });

  it('занятый логин (23505) — loginTaken, откат, журнал пуст', async () => {
    const f = fakePool({ insertFails: true });
    const res = await createOperator(
      { actorId: ACTOR, login: 'j.doe', displayName: 'John', role: 'operator', password: VALID_PASSWORD, reason: 'ок' },
      f.pool,
    );
    expect(res).toEqual({ ok: false, reason: 'loginTaken' });
    expect(f.journal).toHaveLength(0);
    expect(f.flags.rolledBack).toBe(true);
  });
});

describe('ADM-04 · disableOperator', () => {
  it('отключает активного и пишет operator.disabled с основанием', async () => {
    const f = fakePool({ row: { role: 'operator', login: 'j.doe', disabledAt: null } });
    const res = await disableOperator({ actorId: ACTOR, operatorId: TARGET, reason: 'ушёл из компании' }, f.pool);
    expect(res).toEqual({ ok: true });
    expect(f.journal[0]!.action).toBe('operator.disabled');
    expect(JSON.parse(f.journal[0]!.payload).basis).toBe('ушёл из компании');
    expect(f.flags.committed).toBe(true);
  });

  it('нельзя отключить самого себя (fail-closed)', async () => {
    const f = fakePool({});
    const res = await disableOperator({ actorId: ACTOR, operatorId: ACTOR, reason: 'x' }, f.pool);
    expect(res).toEqual({ ok: false, reason: 'selfDisable' });
    expect(f.flags.begun).toBe(false);
  });

  it('уже отключённый — notActive, откат', async () => {
    const f = fakePool({ row: { role: 'operator', login: 'j.doe', disabledAt: 'was' } });
    const res = await disableOperator({ actorId: ACTOR, operatorId: TARGET, reason: 'x' }, f.pool);
    expect(res).toEqual({ ok: false, reason: 'notActive' });
    expect(f.journal).toHaveLength(0);
    expect(f.flags.rolledBack).toBe(true);
  });

  it('без основания — отказ до транзакции', async () => {
    const f = fakePool({});
    const res = await disableOperator({ actorId: ACTOR, operatorId: TARGET, reason: '' }, f.pool);
    expect(res).toEqual({ ok: false, reason: 'missingReason' });
    expect(f.flags.begun).toBe(false);
  });
});

describe('ADM-04 · changeOperatorRole', () => {
  it('меняет роль и пишет operator.role_changed с diff from→to', async () => {
    const f = fakePool({ row: { role: 'operator', login: 'j.doe', disabledAt: null } });
    const res = await changeOperatorRole({ actorId: ACTOR, operatorId: TARGET, newRole: 'admin', reason: 'повышение' }, f.pool);
    expect(res).toEqual({ ok: true, from: 'operator', to: 'admin' });
    expect(f.journal[0]!.action).toBe('operator.role_changed');
    const payload = JSON.parse(f.journal[0]!.payload);
    expect(payload.from).toBe('operator');
    expect(payload.to).toBe('admin');
    expect(payload.basis).toBe('повышение');
  });

  it('нельзя менять собственную роль', async () => {
    const f = fakePool({});
    const res = await changeOperatorRole({ actorId: ACTOR, operatorId: ACTOR, newRole: 'operator', reason: 'x' }, f.pool);
    expect(res).toEqual({ ok: false, reason: 'selfRoleChange' });
    expect(f.flags.begun).toBe(false);
  });

  it('та же роль — noChange, откат, журнал пуст', async () => {
    const f = fakePool({ row: { role: 'admin', login: 'a', disabledAt: null } });
    const res = await changeOperatorRole({ actorId: ACTOR, operatorId: TARGET, newRole: 'admin', reason: 'x' }, f.pool);
    expect(res).toEqual({ ok: false, reason: 'noChange' });
    expect(f.journal).toHaveLength(0);
    expect(f.flags.rolledBack).toBe(true);
  });

  it('нет такого оператора — notFound', async () => {
    const f = fakePool({ row: null });
    const res = await changeOperatorRole({ actorId: ACTOR, operatorId: TARGET, newRole: 'admin', reason: 'x' }, f.pool);
    expect(res).toEqual({ ok: false, reason: 'notFound' });
    expect(f.flags.rolledBack).toBe(true);
  });
});
