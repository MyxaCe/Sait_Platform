import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { revokeClientSessions, setClientBlock } from './block';

/**
 * ADM-02 · блокировка/разблокировка клиента (Р-049, Р-394).
 *
 * База не поднимается — её роль играет in-memory фейк-клиент, ведущий себя как
 * `client_blocks` + `admin_action_journal` в одной транзакции: гард «клиент
 * существует», переход только содержательный, append в журнал, привязка
 * last_journal_seq. Проверяем разрешённые/запрещённые переходы и что КАЖДОЕ
 * успешное решение попадает в журнал с основанием.
 */

const USER = '22222222-2222-2222-2222-222222222222';
const OP = '11111111-1111-1111-1111-111111111111';
const OTHER = '33333333-3333-3333-3333-333333333333';

interface JournalRow {
  seq: number;
  action: string;
  subject_kind: string;
  subject_id: string;
  payload: string;
  entry_hash: string;
}

function fakePool(opts: { exists?: boolean; blocked?: boolean | null; sessions?: string[] }) {
  const exists = opts.exists ?? true;
  // Строки `sessions` (id → user_id): гашение должно трогать только этого клиента.
  const sessions = new Map<string, string>((opts.sessions ?? []).map((id) => [id, USER]));
  sessions.set('other-client-session', OTHER);
  const block = { value: opts.blocked ?? null as boolean | null, lastJournalSeq: null as number | null };
  const journal: JournalRow[] = [];
  let begun = false;
  let rolledBack = false;
  let committed = false;

  const client = {
    async query(sql: string, params: unknown[] = []) {
      if (/^BEGIN/i.test(sql)) return (begun = true), { rows: [], rowCount: 0 };
      if (/^ROLLBACK/i.test(sql)) return (rolledBack = true), { rows: [], rowCount: 0 };
      if (/^COMMIT/i.test(sql)) return (committed = true), { rows: [], rowCount: 0 };
      if (/SELECT 1 FROM users WHERE id/i.test(sql)) {
        return { rows: exists ? [{ '?column?': 1 }] : [], rowCount: exists ? 1 : 0 };
      }
      if (/SELECT blocked FROM client_blocks/i.test(sql)) {
        return { rows: block.value === null ? [] : [{ blocked: block.value }], rowCount: block.value === null ? 0 : 1 };
      }
      if (/INSERT INTO client_blocks/i.test(sql)) {
        block.value = params[1] as boolean;
        return { rows: [], rowCount: 1 };
      }
      if (/pg_advisory_xact_lock/i.test(sql)) {
        return { rows: [{ pg_advisory_xact_lock: '' }], rowCount: 1 };
      }
      if (/SELECT entry_hash FROM admin_action_journal/i.test(sql)) {
        const last = journal[journal.length - 1];
        return { rows: last ? [{ entry_hash: last.entry_hash }] : [], rowCount: last ? 1 : 0 };
      }
      if (/INSERT INTO admin_action_journal/i.test(sql)) {
        const p = params as string[];
        journal.push({
          seq: journal.length + 1,
          action: p[2]!,
          subject_kind: p[3]!,
          subject_id: p[4]!,
          payload: p[5]!,
          entry_hash: p[7]!,
        });
        return { rows: [], rowCount: 0 };
      }
      if (/SELECT seq FROM admin_action_journal WHERE entry_hash/i.test(sql)) {
        const found = journal.find((r) => r.entry_hash === params[0]);
        return { rows: found ? [{ seq: found.seq }] : [], rowCount: found ? 1 : 0 };
      }
      if (/UPDATE client_blocks SET last_journal_seq/i.test(sql)) {
        block.lastJournalSeq = params[1] as number;
        return { rows: [], rowCount: 1 };
      }
      if (/DELETE FROM sessions WHERE user_id = \$1 RETURNING id/i.test(sql)) {
        const gone = [...sessions].filter(([, uid]) => uid === params[0]).map(([id]) => id);
        for (const id of gone) sessions.delete(id);
        return { rows: gone.map((id) => ({ id })), rowCount: gone.length };
      }
      throw new Error(`unexpected sql: ${sql}`);
    },
    release() {},
  };

  const pool = { async connect() { return client as unknown as PoolClient; } };
  return { pool, block, journal, sessions, flags: () => ({ begun, rolledBack, committed }) };
}

describe('ADM-02 · блокировка клиента', () => {
  it('не заблокирован → блок: состояние меняется, пишется в журнал с основанием', async () => {
    const f = fakePool({ blocked: null });
    const res = await setClientBlock(
      { operatorId: OP, userId: USER, action: 'block', reason: 'подозрение в мошенничестве' },
      f.pool,
    );

    expect(res).toMatchObject({ ok: true, blocked: true });
    expect(f.block.value).toBe(true);
    expect(f.journal).toHaveLength(1);
    expect(f.journal[0]!.action).toBe('client.block');
    expect(f.journal[0]!.subject_kind).toBe('client');
    expect(f.journal[0]!.subject_id).toBe(USER);
    expect(JSON.parse(f.journal[0]!.payload).basis).toBe('подозрение в мошенничестве');
    expect(JSON.parse(f.journal[0]!.payload).previousBlocked).toBe(false);
    expect(f.block.lastJournalSeq).toBe(1);
    expect(f.flags().committed).toBe(true);
  });

  it('заблокирован → разблок: состояние меняется, пишется client.unblock', async () => {
    const f = fakePool({ blocked: true });
    const res = await setClientBlock(
      { operatorId: OP, userId: USER, action: 'unblock', reason: 'разобрались, ложная тревога' },
      f.pool,
    );

    expect(res).toMatchObject({ ok: true, blocked: false });
    expect(f.block.value).toBe(false);
    expect(f.journal[0]!.action).toBe('client.unblock');
    expect(JSON.parse(f.journal[0]!.payload).previousBlocked).toBe(true);
    expect(f.flags().committed).toBe(true);
  });

  it('без основания — отказ, транзакции нет, в журнал ничего (fail-closed)', async () => {
    const f = fakePool({ blocked: null });
    const res = await setClientBlock({ operatorId: OP, userId: USER, action: 'block', reason: '  ' }, f.pool);

    expect(res).toEqual({ ok: false, reason: 'missingReason' });
    expect(f.journal).toHaveLength(0);
    expect(f.flags().begun).toBe(false);
  });

  it('уже заблокирован → блок: нет содержательного перехода, откат', async () => {
    const f = fakePool({ blocked: true });
    const res = await setClientBlock(
      { operatorId: OP, userId: USER, action: 'block', reason: 'повторно' },
      f.pool,
    );

    expect(res).toEqual({ ok: false, reason: 'alreadyInState' });
    expect(f.journal).toHaveLength(0);
    expect(f.flags().rolledBack).toBe(true);
    expect(f.flags().committed).toBe(false);
  });

  it('нет такого клиента → noClient, откат, журнал пуст', async () => {
    const f = fakePool({ exists: false });
    const res = await setClientBlock(
      { operatorId: OP, userId: USER, action: 'block', reason: 'есть основание' },
      f.pool,
    );

    expect(res).toEqual({ ok: false, reason: 'noClient' });
    expect(f.journal).toHaveLength(0);
    expect(f.flags().rolledBack).toBe(true);
  });
});

describe('ADM-02 · блокировка действует по-настоящему: сессии гасятся', () => {
  it('блок → сессии клиента удалены ТОЙ ЖЕ транзакцией, число — в журнале', async () => {
    const f = fakePool({ blocked: null, sessions: ['s1', 's2'] });
    const res = await setClientBlock(
      { operatorId: OP, userId: USER, action: 'block', reason: 'AML' },
      f.pool,
    );

    expect(res).toMatchObject({ ok: true, blocked: true });
    expect([...f.sessions.keys()]).toEqual(['other-client-session']);
    expect(JSON.parse(f.journal[0]!.payload).sessionsRevoked).toBe(2);
    expect(f.flags().committed).toBe(true);
  });

  it('разблок → сессии не трогаются (их и нет), доступ возвращается через client_blocks', async () => {
    const f = fakePool({ blocked: true });
    const res = await setClientBlock(
      { operatorId: OP, userId: USER, action: 'unblock', reason: 'проверено' },
      f.pool,
    );

    expect(res).toMatchObject({ ok: true, blocked: false });
    expect(f.block.value).toBe(false);
    expect(f.sessions.has('other-client-session')).toBe(true);
    expect(JSON.parse(f.journal[0]!.payload).sessionsRevoked).toBeUndefined();
  });

  it('уже заблокирован → повторный блок ничего не гасит (откат)', async () => {
    const f = fakePool({ blocked: true, sessions: ['s1'] });
    const res = await setClientBlock(
      { operatorId: OP, userId: USER, action: 'block', reason: 'повторно' },
      f.pool,
    );

    expect(res).toEqual({ ok: false, reason: 'alreadyInState' });
    expect(f.sessions.has('s1')).toBe(true);
  });
});

describe('ADM-02 · «погасить сессии»', () => {
  it('удаляет сессии клиента и пишет client.sessions_revoked с основанием и числом', async () => {
    const f = fakePool({ blocked: null, sessions: ['s1', 's2', 's3'] });
    const res = await revokeClientSessions({ operatorId: OP, userId: USER, reason: 'утечка пароля' }, f.pool);

    expect(res).toMatchObject({ ok: true, revoked: 3, journalSeq: 1 });
    expect([...f.sessions.keys()]).toEqual(['other-client-session']);
    expect(f.journal[0]!.action).toBe('client.sessions_revoked');
    expect(JSON.parse(f.journal[0]!.payload)).toMatchObject({ basis: 'утечка пароля', revoked: 3 });
    expect(f.block.value).toBeNull();
    expect(f.flags().committed).toBe(true);
  });

  it('без основания — отказ, ничего не удалено, транзакции нет', async () => {
    const f = fakePool({ sessions: ['s1'] });
    const res = await revokeClientSessions({ operatorId: OP, userId: USER, reason: ' ' }, f.pool);

    expect(res).toEqual({ ok: false, reason: 'missingReason' });
    expect(f.sessions.has('s1')).toBe(true);
    expect(f.flags().begun).toBe(false);
  });

  it('нет клиента → noClient, откат', async () => {
    const f = fakePool({ exists: false });
    const res = await revokeClientSessions({ operatorId: OP, userId: USER, reason: 'x' }, f.pool);

    expect(res).toEqual({ ok: false, reason: 'noClient' });
    expect(f.journal).toHaveLength(0);
    expect(f.flags().rolledBack).toBe(true);
  });
});
