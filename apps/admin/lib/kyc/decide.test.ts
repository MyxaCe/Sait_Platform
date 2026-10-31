import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { decideClientVerification } from './decide';
import type { VerificationState } from './queries';

/**
 * ADM-08 · state-machine решения по KYC (Р-451 п.4, Р-049).
 *
 * База не поднимается — её роль играет in-memory фейк-клиент, который ведёт
 * себя как `client_verification` + `admin_action_journal` в одной транзакции:
 * UPDATE с гардом `WHERE state='pending'`, append в журнал, выборка seq,
 * привязка last_journal_seq. Проверяем разрешённые/запрещённые переходы и что
 * КАЖДОЕ успешное решение попадает в журнал.
 */

const USER = '22222222-2222-2222-2222-222222222222';
const OP = '11111111-1111-1111-1111-111111111111';

interface JournalRow {
  seq: number;
  action: string;
  subject_kind: string;
  subject_id: string;
  payload: string;
  entry_hash: string;
}

/** Фейк пула: один клиент, одна строка client_verification, журнал-массив. */
function fakePool(initialState: VerificationState) {
  const state = { value: initialState, lastJournalSeq: null as number | null };
  const journal: JournalRow[] = [];
  let begun = false;
  let rolledBack = false;
  let committed = false;

  const client = {
    async query(sql: string, params: unknown[] = []) {
      if (/^BEGIN/i.test(sql)) {
        begun = true;
        return { rows: [], rowCount: 0 };
      }
      if (/^ROLLBACK/i.test(sql)) {
        rolledBack = true;
        return { rows: [], rowCount: 0 };
      }
      if (/^COMMIT/i.test(sql)) {
        committed = true;
        return { rows: [], rowCount: 0 };
      }
      if (/UPDATE client_verification\s+SET state/i.test(sql)) {
        // Гард: обновляем только из pending.
        if (state.value !== 'pending') return { rows: [], rowCount: 0 };
        state.value = params[1] as VerificationState;
        return { rows: [{ user_id: params[0] }], rowCount: 1 };
      }
      if (/pg_advisory_xact_lock/i.test(sql)) {
        // Сериализация аппендов журнала (ADM-09): appendJournalEntry берёт
        // advisory-lock перед чтением prev_hash. Фейку достаточно принять запрос.
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
      if (/UPDATE client_verification SET last_journal_seq/i.test(sql)) {
        state.lastJournalSeq = params[1] as number;
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected sql: ${sql}`);
    },
    release() {},
  };

  const pool = { async connect() { return client as unknown as PoolClient; } };
  return { pool, state, journal, flags: () => ({ begun, rolledBack, committed }) };
}

describe('ADM-08 · решение по верификации', () => {
  it('pending → verified: состояние меняется и пишется в журнал', async () => {
    const f = fakePool('pending');
    const res = await decideClientVerification({ operatorId: OP, userId: USER, decision: 'verified' }, f.pool);

    expect(res.ok).toBe(true);
    expect(f.state.value).toBe('verified');
    expect(f.journal).toHaveLength(1);
    expect(f.journal[0]!.action).toBe('client.verification.verified');
    expect(f.journal[0]!.subject_kind).toBe('client');
    expect(f.journal[0]!.subject_id).toBe(USER);
    expect(f.state.lastJournalSeq).toBe(f.journal[0]!.seq);
    expect(f.flags().committed).toBe(true);
  });

  it('pending → rejected с причиной: причина уходит в payload журнала', async () => {
    const f = fakePool('pending');
    const res = await decideClientVerification(
      { operatorId: OP, userId: USER, decision: 'rejected', reason: 'селфи нечитаемо' },
      f.pool,
    );

    expect(res.ok).toBe(true);
    expect(f.state.value).toBe('rejected');
    expect(f.journal[0]!.action).toBe('client.verification.rejected');
    expect(JSON.parse(f.journal[0]!.payload).basis).toBe('селфи нечитаемо');
  });

  it('rejected без причины — отказ, ничего не меняется и не пишется (fail-closed)', async () => {
    const f = fakePool('pending');
    const res = await decideClientVerification({ operatorId: OP, userId: USER, decision: 'rejected' }, f.pool);

    expect(res).toEqual({ ok: false, reason: 'missingReason' });
    expect(f.state.value).toBe('pending');
    expect(f.journal).toHaveLength(0);
    expect(f.flags().begun).toBe(false);
  });

  it('клиент не в pending — отказ notPending, журнал пуст, транзакция откатана', async () => {
    const f = fakePool('verified');
    const res = await decideClientVerification({ operatorId: OP, userId: USER, decision: 'verified' }, f.pool);

    expect(res).toEqual({ ok: false, reason: 'notPending' });
    expect(f.state.value).toBe('verified');
    expect(f.journal).toHaveLength(0);
    expect(f.flags().rolledBack).toBe(true);
    expect(f.flags().committed).toBe(false);
  });

  it('unverified (ещё не подал) оператор решать не может', async () => {
    const f = fakePool('unverified');
    const res = await decideClientVerification({ operatorId: OP, userId: USER, decision: 'verified' }, f.pool);
    expect(res).toEqual({ ok: false, reason: 'notPending' });
  });
});
