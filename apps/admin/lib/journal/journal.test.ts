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
 *
 * Сериализацию аппендов (advisory-lock) настоящей двух-коннектовой гонкой тут
 * не прогнать — пул мокается. Поэтому доказываем ЛОГИКУ: порядок вызовов
 * `query` (lock → select → insert, с BEGIN/COMMIT для пула и без них для
 * клиента) и fail-closed при сбое. Настоящую гонку надо гонять на реальном
 * Postgres (см. раздел «журнал · сериализация аппендов»).
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

/** Классификатор SQL — в тег, чтобы проверять порядок обращений к базе. */
function tagSql(sql: string): string {
  if (/^\s*BEGIN/i.test(sql)) return 'BEGIN';
  if (/^\s*COMMIT/i.test(sql)) return 'COMMIT';
  if (/^\s*ROLLBACK/i.test(sql)) return 'ROLLBACK';
  if (/pg_advisory_xact_lock/i.test(sql)) return 'LOCK';
  if (/SELECT entry_hash/i.test(sql)) return 'SELECT_PREV';
  if (/INSERT INTO admin_action_journal/i.test(sql)) return 'INSERT';
  return `OTHER(${sql})`;
}

/** Общий исполнитель запросов над in-memory таблицей журнала. */
function runQuery(rows: Stored[], sql: string, params: unknown[]): { rows: Record<string, unknown>[] } {
  const tag = tagSql(sql);
  if (tag === 'SELECT_PREV') {
    const last = rows[rows.length - 1];
    return { rows: last ? [{ entry_hash: last.entry_hash }] : [] };
  }
  if (tag === 'INSERT') {
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
  if (tag === 'LOCK' || tag === 'BEGIN' || tag === 'COMMIT' || tag === 'ROLLBACK') {
    return { rows: [] };
  }
  throw new Error(`unexpected sql: ${sql}`);
}

/**
 * Клиент-эмулятор (как `PoolClient`): есть `release`, поэтому функция считает
 * его клиентом чужой транзакции и НЕ открывает свою. Ведёт лог тегов SQL.
 * `failOn` — на каком теге бросить (для fail-closed).
 */
function makeClient(opts: { rows?: Stored[]; failOn?: string } = {}) {
  const rows = opts.rows ?? [];
  const log: string[] = [];
  const client = {
    rows,
    log,
    released: 0,
    async query(sql: string, params: unknown[] = []) {
      const tag = tagSql(sql);
      log.push(tag);
      if (opts.failOn && tag === opts.failOn) {
        throw new Error(`boom:${tag}`);
      }
      return runQuery(rows, sql, params);
    },
    release() {
      client.released += 1;
    },
  };
  return client;
}

/**
 * Пул-эмулятор (как `pg.Pool`): есть `connect`, НЕТ `release`, поэтому функция
 * сама берёт клиента и оборачивает аппенд транзакцией. Возвращает один и тот же
 * клиент, чтобы тест видел его лог.
 */
function makePool(client: ReturnType<typeof makeClient>) {
  return {
    async query() {
      throw new Error('пул не должен вызываться напрямую — ожидался connect()');
    },
    async connect() {
      return client as unknown as import('pg').PoolClient;
    },
  } as unknown as Queryable;
}

/** Таблица-эмулятор как Queryable без connect/release — путь «клиент дан». */
function fakeJournal(): { db: Queryable; rows: Stored[] } {
  const rows: Stored[] = [];
  const db: Queryable = {
    async query(sql: string, params: unknown[] = []) {
      return runQuery(rows, sql, params);
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

describe('журнал · сериализация аппендов (Р-049)', () => {
  it('genesis: при пустом журнале prev_hash = null', async () => {
    const client = makeClient();
    const entry = await appendJournalEntry(
      { operatorId: OP, action: 'operator.login', subjectKind: 'operator', subjectId: OP },
      client as unknown as Queryable,
    );
    expect(entry.prevHash).toBeNull();
  });

  it('дали пул: BEGIN → LOCK → SELECT prev → INSERT → COMMIT, именно в этом порядке', async () => {
    const client = makeClient();
    const pool = makePool(client);

    const entry = await appendJournalEntry(
      { operatorId: OP, action: 'operator.login', subjectKind: 'operator', subjectId: OP, payload: { login: 'root' } },
      pool,
    );

    // Lock берётся ПОСЛЕ BEGIN и ДО чтения prev; вся работа обёрнута COMMIT-ом.
    expect(client.log).toEqual(['BEGIN', 'LOCK', 'SELECT_PREV', 'INSERT', 'COMMIT']);
    // Клиента вернули в пул ровно один раз.
    expect(client.released).toBe(1);
    // Запись реально легла в таблицу.
    expect(client.rows).toHaveLength(1);
    expect(entry.entryHash).toBe(client.rows[0]!.entry_hash);
  });

  it('дали client: LOCK → SELECT prev → INSERT, БЕЗ собственных BEGIN/COMMIT', async () => {
    const client = makeClient();

    await appendJournalEntry(
      { operatorId: OP, action: 'client.verification.verified', subjectKind: 'client', subjectId: 'c1' },
      client as unknown as Queryable,
    );

    // Lock — первым, ДО чтения prev. Транзакцией распоряжается вызывающий:
    // своих BEGIN/COMMIT/ROLLBACK функция не делает, клиента не освобождает.
    expect(client.log).toEqual(['LOCK', 'SELECT_PREV', 'INSERT']);
    expect(client.log).not.toContain('BEGIN');
    expect(client.log).not.toContain('COMMIT');
    expect(client.released).toBe(0);
  });

  it('fail-closed (пул): сбой на LOCK → ROLLBACK, release, НЕ пишем без lock', async () => {
    const client = makeClient({ failOn: 'LOCK' });
    const pool = makePool(client);

    await expect(
      appendJournalEntry(
        { operatorId: OP, action: 'operator.login', subjectKind: 'operator', subjectId: OP },
        pool,
      ),
    ).rejects.toThrow('boom:LOCK');

    // Откатили и освободили клиента; INSERT не случился — записи без lock нет.
    expect(client.log).toEqual(['BEGIN', 'LOCK', 'ROLLBACK']);
    expect(client.log).not.toContain('INSERT');
    expect(client.released).toBe(1);
    expect(client.rows).toHaveLength(0);
  });

  it('fail-closed (client): сбой на LOCK прокидывается наверх, INSERT не идёт', async () => {
    const client = makeClient({ failOn: 'LOCK' });

    await expect(
      appendJournalEntry(
        { operatorId: OP, action: 'client.verification.rejected', subjectKind: 'client', subjectId: 'c1' },
        client as unknown as Queryable,
      ),
    ).rejects.toThrow('boom:LOCK');

    expect(client.log).toEqual(['LOCK']);
    expect(client.rows).toHaveLength(0);
  });

  it('канонизация не изменилась: хеш через пул совпадает с независимым пересчётом', async () => {
    const client = makeClient();
    const pool = makePool(client);
    const payload = { a: 1, b: [2, 3] };

    const entry = await appendJournalEntry(
      { operatorId: OP, action: 'operator.login', subjectKind: 'operator', subjectId: OP, payload },
      pool,
    );

    const recomputed = computeEntryHash({
      prevHash: null,
      occurredAt: entry.occurredAt,
      operatorId: OP,
      action: 'operator.login',
      subjectKind: 'operator',
      subjectId: OP,
      payload,
    });
    expect(entry.entryHash).toBe(recomputed);
  });
});
