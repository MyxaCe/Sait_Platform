import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { recordAmlScreening } from './screening';

/**
 * ADM-14 · фиксация результата ручного AML-скрининга (Р-454 I-5, Р-049).
 *
 * База не поднимается — её роль играет in-memory фейк-клиент, который ведёт
 * себя как `client_aml_screening` + `admin_action_journal` в одной транзакции:
 * проверка существования клиента, upsert статуса, append в журнал, выборка seq,
 * привязка last_journal_seq. Проверяем оба исхода, обязательность основания и
 * непустого набора списков, и что КАЖДЫЙ успешный скрининг попадает в журнал.
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

/** Фейк пула: одна строка client_aml_screening + журнал-массив. */
function fakePool(opts: { userExists?: boolean } = {}) {
  const userExists = opts.userExists ?? true;
  const row = {
    status: null as string | null,
    lists: null as string[] | null,
    reason: null as string | null,
    lastJournalSeq: null as number | null,
  };
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
      if (/SELECT 1 FROM users WHERE id/i.test(sql)) {
        return { rows: userExists ? [{ '?column?': 1 }] : [], rowCount: userExists ? 1 : 0 };
      }
      if (/INSERT INTO client_aml_screening\s+\(user_id, status/i.test(sql)) {
        row.status = params[1] as string;
        row.lists = params[2] as string[];
        row.reason = params[3] as string;
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
      if (/UPDATE client_aml_screening SET last_journal_seq/i.test(sql)) {
        row.lastJournalSeq = params[1] as number;
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected sql: ${sql}`);
    },
    release() {},
  };

  const pool = { async connect() { return client as unknown as PoolClient; } };
  return { pool, row, journal, flags: () => ({ begun, rolledBack, committed }) };
}

describe('ADM-14 · запись AML-скрининга', () => {
  it('clear: статус и списки сохранены, пишется client.aml_checked', async () => {
    const f = fakePool();
    const res = await recordAmlScreening(
      { operatorId: OP, userId: USER, outcome: 'clear', listsChecked: ['ofsi', 'ofac', 'eu'], reason: 'ручная сверка, совпадений нет' },
      f.pool,
    );

    expect(res).toMatchObject({ ok: true, status: 'clear' });
    expect(f.row.status).toBe('clear');
    expect(f.row.lists).toEqual(['ofsi', 'ofac', 'eu']);
    expect(f.journal).toHaveLength(1);
    expect(f.journal[0]!.action).toBe('client.aml_checked');
    expect(f.journal[0]!.subject_kind).toBe('client');
    expect(f.journal[0]!.subject_id).toBe(USER);
    expect(JSON.parse(f.journal[0]!.payload).basis).toBe('ручная сверка, совпадений нет');
    expect(JSON.parse(f.journal[0]!.payload).lists).toEqual(['ofsi', 'ofac', 'eu']);
    expect(f.row.lastJournalSeq).toBe(f.journal[0]!.seq);
    expect(f.flags().committed).toBe(true);
  });

  it('escalated: пишется client.aml_escalated', async () => {
    const f = fakePool();
    const res = await recordAmlScreening(
      { operatorId: OP, userId: USER, outcome: 'escalated', listsChecked: ['ofac'], reason: 'совпадение по OFAC — на эскалацию' },
      f.pool,
    );

    expect(res).toMatchObject({ ok: true, status: 'escalated' });
    expect(f.row.status).toBe('escalated');
    expect(f.journal[0]!.action).toBe('client.aml_escalated');
    expect(JSON.parse(f.journal[0]!.payload).outcome).toBe('escalated');
  });

  it('без основания — отказ, транзакция даже не начинается (fail-closed)', async () => {
    const f = fakePool();
    const res = await recordAmlScreening(
      { operatorId: OP, userId: USER, outcome: 'clear', listsChecked: ['ofsi'], reason: '   ' },
      f.pool,
    );

    expect(res).toEqual({ ok: false, reason: 'missingReason' });
    expect(f.journal).toHaveLength(0);
    expect(f.flags().begun).toBe(false);
  });

  it('без списков — отказ noLists, ничего не пишется', async () => {
    const f = fakePool();
    const res = await recordAmlScreening(
      { operatorId: OP, userId: USER, outcome: 'clear', listsChecked: [], reason: 'сверил' },
      f.pool,
    );

    expect(res).toEqual({ ok: false, reason: 'noLists' });
    expect(f.journal).toHaveLength(0);
    expect(f.flags().begun).toBe(false);
  });

  it('неизвестные списки отфильтрованы; если после фильтра пусто — noLists', async () => {
    const f = fakePool();
    const res = await recordAmlScreening(
      // 'xyz' не из реестра — отбрасывается, остаётся пусто.
      { operatorId: OP, userId: USER, outcome: 'clear', listsChecked: ['xyz' as never], reason: 'сверил' },
      f.pool,
    );
    expect(res).toEqual({ ok: false, reason: 'noLists' });
  });

  it('нет такого клиента — отказ noClient, транзакция откатана', async () => {
    const f = fakePool({ userExists: false });
    const res = await recordAmlScreening(
      { operatorId: OP, userId: USER, outcome: 'clear', listsChecked: ['eu'], reason: 'сверил' },
      f.pool,
    );

    expect(res).toEqual({ ok: false, reason: 'noClient' });
    expect(f.journal).toHaveLength(0);
    expect(f.flags().rolledBack).toBe(true);
    expect(f.flags().committed).toBe(false);
  });
});
