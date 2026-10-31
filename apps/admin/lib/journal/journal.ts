import { createHash } from 'node:crypto';
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
 * Добавляет запись в журнал. Только INSERT — правка запрещена базой.
 *
 * `db` по умолчанию — пул; передаётся явно, когда запись должна идти ТОЙ ЖЕ
 * транзакцией, что и действие (например, сид: создание первого оператора и
 * запись о нём — одной транзакцией).
 *
 * `occurredAt` генерируется ЗДЕСЬ и пишется в строку явно, а не берётся из
 * `DEFAULT now()`: он входит в хеш, и расхождение времени в строке с временем
 * в хеше порвало бы цепочку. Один источник времени — код записи.
 */
export async function appendJournalEntry(
  input: JournalEntryInput,
  db: Queryable = getPool(),
): Promise<JournalEntry> {
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
