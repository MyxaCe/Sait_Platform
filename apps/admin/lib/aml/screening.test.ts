import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { clearAmlEscalation, recordAmlScreening } from './screening';

/**
 * ADM-14 · фиксация результата ручного AML-скрининга (Р-454 I-5, Р-456 D, Р-049).
 *
 * База не поднимается — её роль играет in-memory фейк-клиент, который ведёт
 * себя как `client_aml_screening` + `client_blocks` + `admin_action_journal` в
 * одной транзакции. Проверяем: оба исхода, обязательность основания и непустого
 * набора списков, ТРИ списка обязательны для `clear` (Р-456 D), АВТО-БЛОК при
 * `escalated` той же транзакцией, и отдельное снятие эскалации с разблокировкой.
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

function fakePool(opts: { userExists?: boolean; amlStatus?: string | null; blocked?: boolean | null } = {}) {
  const userExists = opts.userExists ?? true;
  const aml = {
    status: opts.amlStatus ?? (null as string | null),
    lists: null as string[] | null,
    reason: null as string | null,
    lastJournalSeq: null as number | null,
  };
  const block = { value: opts.blocked ?? (null as boolean | null), lastJournalSeq: null as number | null };
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
        return { rows: userExists ? [{ '?column?': 1 }] : [], rowCount: userExists ? 1 : 0 };
      }
      if (/INSERT INTO client_aml_screening\s+\(user_id, status/i.test(sql)) {
        aml.status = params[1] as string;
        aml.lists = params[2] as string[];
        aml.reason = params[3] as string;
        return { rows: [], rowCount: 1 };
      }
      if (/SELECT status FROM client_aml_screening WHERE user_id = \$1 FOR UPDATE/i.test(sql)) {
        return { rows: aml.status === null ? [] : [{ status: aml.status }], rowCount: aml.status === null ? 0 : 1 };
      }
      if (/UPDATE client_aml_screening\s+SET status = 'clear'/i.test(sql)) {
        aml.status = 'clear';
        aml.reason = params[1] as string;
        return { rows: [], rowCount: 1 };
      }
      if (/UPDATE client_aml_screening SET last_journal_seq/i.test(sql)) {
        aml.lastJournalSeq = params[1] as number;
        return { rows: [], rowCount: 1 };
      }
      if (/SELECT blocked FROM client_blocks/i.test(sql)) {
        return { rows: block.value === null ? [] : [{ blocked: block.value }], rowCount: block.value === null ? 0 : 1 };
      }
      if (/INSERT INTO client_blocks/i.test(sql)) {
        block.value = params[1] as boolean;
        return { rows: [], rowCount: 1 };
      }
      if (/UPDATE client_blocks SET last_journal_seq/i.test(sql)) {
        block.lastJournalSeq = params[1] as number;
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
      throw new Error(`unexpected sql: ${sql}`);
    },
    release() {},
  };

  const pool = { async connect() { return client as unknown as PoolClient; } };
  return { pool, aml, block, journal, flags: () => ({ begun, rolledBack, committed }) };
}

describe('ADM-14 · запись AML-скрининга', () => {
  it('clear по всем трём спискам: статус clear, client.aml_checked, клиент НЕ блокируется', async () => {
    const f = fakePool();
    const res = await recordAmlScreening(
      { operatorId: OP, userId: USER, outcome: 'clear', listsChecked: ['ofsi', 'ofac', 'eu'], reason: 'сверка, совпадений нет' },
      f.pool,
    );

    expect(res).toMatchObject({ ok: true, status: 'clear', autoBlocked: false });
    expect(f.aml.status).toBe('clear');
    expect(f.aml.lists).toEqual(['ofsi', 'ofac', 'eu']);
    expect(f.journal).toHaveLength(1);
    expect(f.journal[0]!.action).toBe('client.aml_checked');
    expect(f.block.value).toBeNull();
    expect(f.flags().committed).toBe(true);
  });

  it('clear НЕ по всем трём спискам — отказ listsIncompleteForClear (Р-456 D)', async () => {
    const f = fakePool();
    const res = await recordAmlScreening(
      { operatorId: OP, userId: USER, outcome: 'clear', listsChecked: ['ofsi', 'ofac'], reason: 'сверка' },
      f.pool,
    );

    expect(res).toEqual({ ok: false, reason: 'listsIncompleteForClear' });
    expect(f.journal).toHaveLength(0);
    expect(f.flags().begun).toBe(false);
  });

  it('escalated: client.aml_escalated И client.block одной транзакцией, клиент заблокирован', async () => {
    const f = fakePool({ blocked: null });
    const res = await recordAmlScreening(
      { operatorId: OP, userId: USER, outcome: 'escalated', listsChecked: ['ofac'], reason: 'совпадение по OFAC' },
      f.pool,
    );

    expect(res).toMatchObject({ ok: true, status: 'escalated', autoBlocked: true });
    expect(f.aml.status).toBe('escalated');
    expect(f.block.value).toBe(true); // авто-блок
    expect(f.journal.map((j) => j.action)).toEqual(['client.aml_escalated', 'client.block']);
    // Основание блока несёт AML-причину и списки.
    expect(JSON.parse(f.journal[1]!.payload).basis).toContain('AML: совпадение');
    expect(JSON.parse(f.journal[1]!.payload).basis).toContain('OFAC');
    expect(f.flags().committed).toBe(true);
  });

  it('escalated на уже заблокированном: эскалация пишется, блок идемпотентен (autoBlocked=false)', async () => {
    const f = fakePool({ blocked: true });
    const res = await recordAmlScreening(
      { operatorId: OP, userId: USER, outcome: 'escalated', listsChecked: ['eu'], reason: 'ещё совпадение' },
      f.pool,
    );

    expect(res).toMatchObject({ ok: true, status: 'escalated', autoBlocked: false });
    // Только AML-запись: содержательного перехода блока нет → client.block не пишется.
    expect(f.journal.map((j) => j.action)).toEqual(['client.aml_escalated']);
    expect(f.flags().committed).toBe(true);
  });

  it('без основания — отказ, транзакции нет (fail-closed)', async () => {
    const f = fakePool();
    const res = await recordAmlScreening(
      { operatorId: OP, userId: USER, outcome: 'escalated', listsChecked: ['ofac'], reason: '   ' },
      f.pool,
    );
    expect(res).toEqual({ ok: false, reason: 'missingReason' });
    expect(f.flags().begun).toBe(false);
  });

  it('без списков — отказ noLists', async () => {
    const f = fakePool();
    const res = await recordAmlScreening(
      { operatorId: OP, userId: USER, outcome: 'escalated', listsChecked: [], reason: 'сверил' },
      f.pool,
    );
    expect(res).toEqual({ ok: false, reason: 'noLists' });
    expect(f.flags().begun).toBe(false);
  });

  it('нет такого клиента — отказ noClient, откат', async () => {
    const f = fakePool({ userExists: false });
    const res = await recordAmlScreening(
      { operatorId: OP, userId: USER, outcome: 'escalated', listsChecked: ['eu'], reason: 'сверил' },
      f.pool,
    );
    expect(res).toEqual({ ok: false, reason: 'noClient' });
    expect(f.journal).toHaveLength(0);
    expect(f.flags().rolledBack).toBe(true);
  });
});

describe('ADM-14 · снятие AML-эскалации (Р-456 D)', () => {
  it('escalated → clear + разблокировка: client.aml_escalation_cleared и client.unblock', async () => {
    const f = fakePool({ amlStatus: 'escalated', blocked: true });
    const res = await clearAmlEscalation(
      { operatorId: OP, userId: USER, reason: 'проверено вручную, однофамилец' },
      f.pool,
    );

    expect(res).toMatchObject({ ok: true, unblocked: true });
    expect(f.aml.status).toBe('clear');
    expect(f.block.value).toBe(false);
    expect(f.journal.map((j) => j.action)).toEqual([
      'client.aml_escalation_cleared',
      'client.unblock',
    ]);
    expect(f.flags().committed).toBe(true);
  });

  it('не в escalated — отказ notEscalated, ничего не меняется', async () => {
    const f = fakePool({ amlStatus: 'clear', blocked: false });
    const res = await clearAmlEscalation(
      { operatorId: OP, userId: USER, reason: 'снять' },
      f.pool,
    );
    expect(res).toEqual({ ok: false, reason: 'notEscalated' });
    expect(f.journal).toHaveLength(0);
    expect(f.flags().rolledBack).toBe(true);
  });

  it('без основания — отказ missingReason, транзакции нет', async () => {
    const f = fakePool({ amlStatus: 'escalated', blocked: true });
    const res = await clearAmlEscalation({ operatorId: OP, userId: USER, reason: ' ' }, f.pool);
    expect(res).toEqual({ ok: false, reason: 'missingReason' });
    expect(f.flags().begun).toBe(false);
  });

  it('escalated, но клиент уже разблокирован: статус→clear, разблокировка идемпотентна', async () => {
    const f = fakePool({ amlStatus: 'escalated', blocked: false });
    const res = await clearAmlEscalation(
      { operatorId: OP, userId: USER, reason: 'ложное' },
      f.pool,
    );
    expect(res).toMatchObject({ ok: true, unblocked: false });
    expect(f.aml.status).toBe('clear');
    // Только AML-запись: содержательного перехода разблокировки нет.
    expect(f.journal.map((j) => j.action)).toEqual(['client.aml_escalation_cleared']);
  });
});
