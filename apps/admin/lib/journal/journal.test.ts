import { describe, expect, it } from 'vitest';
import { appendJournalEntry, canonicalize, computeEntryHash } from './journal';
import type { Queryable } from '../db';

/**
 * ADM-01 · хеш-цепочка журнала не рвётся на серии (Р-049).
 *
 * База в прогоне не поднимается — её роль играет in-memory `Queryable`,
 * которая ведёт себя как таблица: отдаёт `entry_hash` последней строки и
 * принимает INSERT. Проверяется связывание: `prev_hash` каждой записи равен
 * `entry_hash` предыдущей, первая — с `prev_hash = null`, и хранимый хеш
 * совпадает с пересчитанным независимо.
 */

interface Stored {
  seq: number;
  entry_hash: string;
  prev_hash: string | null;
  occurred_at: string;
  operator_id: string;
  action: string;
  subject_kind: string;
  subject_id: string;
  payload: string;
}

/** Таблица-эмулятор: SELECT последнего + INSERT, как делает модуль. */
function fakeJournal(): { db: Queryable; rows: Stored[] } {
  const rows: Stored[] = [];
  const db: Queryable = {
    async query(sql: string, params: unknown[] = []) {
      if (/SELECT entry_hash/i.test(sql)) {
        const last = rows[rows.length - 1];
        return { rows: last ? [{ entry_hash: last.entry_hash }] : [] };
      }
      if (/INSERT INTO admin_action_journal/i.test(sql)) {
        const [occurred_at, operator_id, action, subject_kind, subject_id, payload, prev_hash, entry_hash] =
          params as [string, string, string, string, string, string, string | null, string];
        rows.push({
          seq: rows.length + 1,
          occurred_at,
          operator_id,
          action,
          subject_kind,
          subject_id,
          payload,
          prev_hash,
          entry_hash,
        });
        return { rows: [] };
      }
      throw new Error(`unexpected sql: ${sql}`);
    },
  };
  return { db, rows };
}

const OP = '11111111-1111-1111-1111-111111111111';

describe('журнал · канонизация', () => {
  it('порядок ключей не влияет на результат', () => {
    expect(canonicalize({ a: 1, b: 2 })).toEqual(canonicalize({ b: 2, a: 1 }));
    expect(canonicalize({ x: { p: 1, q: 2 } })).toEqual(canonicalize({ x: { q: 2, p: 1 } }));
  });

  it('порядок массива значим', () => {
    expect(canonicalize([1, 2])).not.toEqual(canonicalize([2, 1]));
  });
});

describe('журнал · сцепление prev→entry', () => {
  it('серия записей образует непрерывную цепочку', async () => {
    const { db } = fakeJournal();

    const first = await appendJournalEntry(
      { operatorId: OP, action: 'operator.login', subjectKind: 'operator', subjectId: OP, payload: { n: 1 } },
      db,
    );
    const second = await appendJournalEntry(
      { operatorId: OP, action: 'client.verify', subjectKind: 'client', subjectId: 'c1', payload: { n: 2 } },
      db,
    );
    const third = await appendJournalEntry(
      { operatorId: OP, action: 'client.reject', subjectKind: 'client', subjectId: 'c2', payload: { n: 3 } },
      db,
    );

    // Первая — начало цепи.
    expect(first.prevHash).toBeNull();
    // Каждая следующая сцеплена с хешем предыдущей.
    expect(second.prevHash).toBe(first.entryHash);
    expect(third.prevHash).toBe(second.entryHash);
    // Хеши различны.
    expect(new Set([first.entryHash, second.entryHash, third.entryHash]).size).toBe(3);
  });

  it('хранимый entry_hash совпадает с независимым пересчётом', async () => {
    const { db, rows } = fakeJournal();

    const entry = await appendJournalEntry(
      { operatorId: OP, action: 'operator.login', subjectKind: 'operator', subjectId: OP, payload: { a: 1, b: [2, 3] } },
      db,
    );

    const recomputed = computeEntryHash({
      prevHash: null,
      occurredAt: entry.occurredAt,
      operatorId: OP,
      action: 'operator.login',
      subjectKind: 'operator',
      subjectId: OP,
      payload: { a: 1, b: [2, 3] },
    });
    expect(entry.entryHash).toBe(recomputed);
    expect(rows[0]!.entry_hash).toBe(recomputed);
  });

  it('изъятие звена делает цепочку несходящейся (обнаружимость)', async () => {
    const { db } = fakeJournal();
    const e1 = await appendJournalEntry(
      { operatorId: OP, action: 'a', subjectKind: 'operator', subjectId: OP },
      db,
    );
    const e2 = await appendJournalEntry(
      { operatorId: OP, action: 'b', subjectKind: 'operator', subjectId: OP },
      db,
    );
    const e3 = await appendJournalEntry(
      { operatorId: OP, action: 'c', subjectKind: 'operator', subjectId: OP },
      db,
    );

    // Убери среднюю — и у e3.prevHash не окажется записи с таким entryHash.
    const remaining = [e1, e3];
    expect(remaining.some((e) => e.entryHash === e3.prevHash)).toBe(false);
    // А пока e2 на месте — находится.
    expect([e1, e2, e3].some((e) => e.entryHash === e3.prevHash)).toBe(true);
  });
});
