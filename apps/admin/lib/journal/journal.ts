import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { getPool, type Queryable } from '../db';

/**
 * Неизменяемый журнал действий оператора (ADM-01, Р-049).
 *
 * Таблица `admin_action_journal` неизменяема НА УРОВНЕ БАЗЫ: триггер
 * запрещает UPDATE/DELETE. Этот модуль только ДОПОЛНЯЕТ её и связывает
 * записи хеш-цепочкой `prev_hash → entry_hash`: изъятие или подмена строки
 * рвут цепочку и становятся видимыми, даже если кто-то обойдёт триггер.
 *
 * Канонизация ЗАФИКСИРОВАНА (стабильный порядок ключей), иначе один и тот же
 * смысл дал бы разные хеши и цепочка «порвалась» бы от перестановки полей в
 * payload. Поэтому хешируется не `JSON.stringify` как есть, а каноническая
 * форма с рекурсивной сортировкой ключей.
 */

export interface JournalEntryInput {
  /** `operators.id` автора действия. */
  operatorId: string;
  /** Что произошло: `operator.login`, `operator.bootstrap`, … */
  action: string;
  /** Род субъекта: `operator`, `client`, … */
  subjectKind: string;
  /** Идентификатор субъекта (строкой — субъекты разнородны). */
  subjectId: string;
  /** Произвольная нагрузка; канонизируется перед хешированием. */
  payload?: Record<string, unknown>;
}

export interface JournalEntry extends Required<JournalEntryInput> {
  occurredAt: string;
  prevHash: string | null;
  entryHash: string;
}

/**
 * Каноническая сериализация: объекты — с ключами по возрастанию, рекурсивно;
 * массивы — в своём порядке (порядок массива значим); примитивы — как есть.
 * Детерминированная строка, по которой считается sha256.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(',')}}`;
}

/**
 * Хеш записи со сцеплением через prev_hash. Вынесен отдельно, чтобы тест мог
 * пересчитать цепочку независимо и поймать, если считалка разойдётся с
 * записью.
 */
export function computeEntryHash(fields: {
  prevHash: string | null;
  occurredAt: string;
  operatorId: string;
  action: string;
  subjectKind: string;
  subjectId: string;
  payload: Record<string, unknown>;
}): string {
  const canonical = canonicalize({
    prevHash: fields.prevHash,
    occurredAt: fields.occurredAt,
    operatorId: fields.operatorId,
    action: fields.action,
    subjectKind: fields.subjectKind,
    subjectId: fields.subjectId,
    payload: fields.payload,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * SQL взятия транзакционного advisory-lock журнала.
 *
 * Аппенды сериализуются ОДНИМ фиксированным на весь журнал ключом:
 * `hashtext('admin_action_journal')`. Ключ один — значит все аппенды встают в
 * одну очередь, а не блокируют друг друга попарно. `hashtext` даёт int4; для
 * однопараметрического `pg_advisory_xact_lock(bigint)` он неявно расширяется до
 * bigint — одно и то же выражение всегда даёт один и тот же ключ в пределах
 * кластера, а большего advisory-lock не требует (он транзиентный, нигде не
 * хранится, межверсионная стабильность `hashtext` неважна).
 *
 * Выбор именно advisory-xact-lock (а не `LOCK TABLE`): он ставит в очередь
 * ТОЛЬКО писателей журнала и НЕ блокирует читателей (аудит журнала идёт
 * параллельно). Lock транзакционный (`_xact_`) — держится до COMMIT и
 * снимается автоматически, освобождать вручную не нужно и нельзя забыть.
 */
const JOURNAL_LOCK_SQL = `SELECT pg_advisory_xact_lock(hashtext('admin_action_journal'))`;

/** Пул умеет выдавать клиента; клиент транзакции — нет, зато у него есть release. */
type PoolLike = Queryable & { connect(): Promise<PoolClient> };

/**
 * Отличает пул от клиента транзакции БЕЗ угадывания по типам (вызывающие
 * передают client как Queryable через каст). У пула есть `connect` и НЕТ
 * `release`; у `PoolClient` — наоборот есть `release`. Проверяем оба признака:
 * `connect` сам по себе неоднозначен (у pg.Client он тоже есть), поэтому
 * отсутствие `release` обязательно.
 */
function isPoolLike(db: Queryable): db is PoolLike {
  const candidate = db as { connect?: unknown; release?: unknown };
  return typeof candidate.connect === 'function' && typeof candidate.release !== 'function';
}

/**
 * Добавляет запись в журнал. Только INSERT — правка запрещена базой.
 *
 * **Сериализация (Р-049).** Два одновременных аппенда под READ COMMITTED в
 * РАЗНЫХ транзакциях прочитали бы ОДИН и тот же «последний» `entry_hash` и оба
 * сцепились бы с одним предшественником — цепочка раздваивается, и
 * доброкачественная гонка неотличима от подмены. Поэтому аппенд берёт
 * транзакционный advisory-lock журнала В САМОМ НАЧАЛЕ, ДО чтения `prev_hash`:
 * select+insert становятся неделимы относительно других аппендов, цепочка
 * строго линейна при любой конкурентности.
 *
 * **Два режима вызова, одинаково корректные:**
 *  - `db` — пул (по умолчанию, автокоммит). `pg_advisory_xact_lock` бесполезен,
 *    если select и insert идут двумя отдельными `pool.query` (каждый — своя
 *    неявная транзакция, lock отпускается сразу). Поэтому функция САМА берёт
 *    клиента, открывает транзакцию (BEGIN), держит lock через весь select+insert
 *    и COMMIT-ит. Так журналируется, например, `operator.login`.
 *  - `db` — клиент чужой транзакции (bootstrap, decide передают его): lock
 *    берётся на ЭТОМ клиенте, он xact-scoped и держится до COMMIT вызывающего;
 *    атомарность select+insert уже обеспечена чужой транзакцией. Своих
 *    BEGIN/COMMIT функция не делает — ими распоряжается вызывающий, запись
 *    оператора/клиента и запись журнала остаются ОДНОЙ транзакцией.
 *
 * **fail-closed.** Если lock или транзакцию взять не удалось — ошибка идёт
 * наверх (в режиме пула с ROLLBACK), запись БЕЗ lock не делается никогда.
 *
 * `occurredAt` генерируется ЗДЕСЬ, ПОСЛЕ взятия lock (т.е. в порядке
 * сериализации), и пишется в строку явно, а не берётся из `DEFAULT now()`: он
 * входит в хеш, и расхождение времени в строке с временем в хеше порвало бы
 * цепочку. Один источник времени — код записи.
 */
export async function appendJournalEntry(
  input: JournalEntryInput,
  db: Queryable = getPool(),
): Promise<JournalEntry> {
  if (!isPoolLike(db)) {
    // Клиент чужой транзакции: lock и select+insert идут в ней, BEGIN/COMMIT — на вызывающем.
    return appendWithinTransaction(input, db);
  }

  // Дали пул: берём клиента и оборачиваем аппенд собственной транзакцией, иначе
  // xact-lock снялся бы между select и insert. fail-closed: любой сбой → ROLLBACK + throw.
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const entry = await appendWithinTransaction(input, client as unknown as Queryable);
    await client.query('COMMIT');
    return entry;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Тело аппенда ВНУТРИ транзакции (своей или чужой): сначала advisory-lock, затем
 * чтение prev и вставка. Порядок критичен — lock до select, иначе сериализации нет.
 */
async function appendWithinTransaction(
  input: JournalEntryInput,
  db: Queryable,
): Promise<JournalEntry> {
  // Очередь аппендов: встаём в неё ДО чтения prev_hash.
  await db.query(JOURNAL_LOCK_SQL);

  const payload = input.payload ?? {};
  const occurredAt = new Date().toISOString();

  const prev = await db.query(
    `SELECT entry_hash FROM admin_action_journal ORDER BY seq DESC LIMIT 1`,
  );
  const prevHash = (prev.rows[0]?.entry_hash as string | undefined) ?? null;

  const entryHash = computeEntryHash({
    prevHash,
    occurredAt,
    operatorId: input.operatorId,
    action: input.action,
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
    payload,
  });

  await db.query(
    `INSERT INTO admin_action_journal
       (occurred_at, operator_id, action, subject_kind, subject_id, payload, prev_hash, entry_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      occurredAt,
      input.operatorId,
      input.action,
      input.subjectKind,
      input.subjectId,
      JSON.stringify(payload),
      prevHash,
      entryHash,
    ],
  );

  return {
    operatorId: input.operatorId,
    action: input.action,
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
    payload,
    occurredAt,
    prevHash,
    entryHash,
  };
}
