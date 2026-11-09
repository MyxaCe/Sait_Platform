import type { PoolClient } from 'pg';
import {
  appendJournalWithinTx,
  canonicalize,
  computeEntryHash,
  type JournalEntry,
  type JournalEntryInput,
} from '@broker/money';
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

/*
 * Реализация аппенда и хеш-цепочки переехала в `@broker/money` (журнал пишут
 * и кабинет, и наблюдатель сети — алгоритм обязан быть один). Здесь — прежний
 * интерфейс админки: умолчание-пул и собственная транзакция, если дали пул.
 */
export { canonicalize, computeEntryHash, type JournalEntry, type JournalEntryInput };

type PoolLike = Queryable & { connect(): Promise<PoolClient> };

function isPoolLike(db: Queryable): db is PoolLike {
  const candidate = db as { connect?: unknown; release?: unknown };
  return typeof candidate.connect === 'function' && typeof candidate.release !== 'function';
}

export async function appendJournalEntry(
  input: JournalEntryInput,
  db: Queryable = getPool(),
): Promise<JournalEntry> {
  if (!isPoolLike(db)) {
    // Клиент чужой транзакции: lock и select+insert идут в ней, BEGIN/COMMIT — на вызывающем.
    return appendJournalWithinTx(input, db);
  }

  // Дали пул: берём клиента и оборачиваем аппенд собственной транзакцией, иначе
  // xact-lock снялся бы между select и insert. fail-closed: любой сбой → ROLLBACK + throw.
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const entry = await appendJournalWithinTx(input, client as unknown as Queryable);
    await client.query('COMMIT');
    return entry;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
