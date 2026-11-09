/**
 * Минимум от драйвера `pg`, нужный пакету. Пул и клиент транзакции ему
 * удовлетворяют; пакет не тянет `pg` сам — драйвер у каждого приложения свой.
 */
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}

/** Клиент транзакции (из `pool.connect()`). */
export interface TxClient extends Queryable {
  release(): void;
}

/** Пул: умеет выдать клиента транзакции. */
export interface PoolLike extends Queryable {
  connect(): Promise<TxClient>;
}

/**
 * Одна транзакция: BEGIN → fn → COMMIT; любой сбой → ROLLBACK + throw.
 * `fn` может вернуть `{ rollback: true, value }`, чтобы откатить без ошибки
 * (исход «ничего не меняем» — например, гард состояния не прошёл).
 */
export async function inTransaction<T>(
  pool: PoolLike,
  fn: (tx: Queryable) => Promise<T | Rollback<T>>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    if (isRollback(out)) {
      await client.query('ROLLBACK');
      return out.value;
    }
    await client.query('COMMIT');
    return out;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export interface Rollback<T> {
  __rollback: true;
  value: T;
}

export function rollback<T>(value: T): Rollback<T> {
  return { __rollback: true, value };
}

function isRollback<T>(v: T | Rollback<T>): v is Rollback<T> {
  return typeof v === 'object' && v !== null && (v as { __rollback?: unknown }).__rollback === true;
}

/** Нарушение уникальности Postgres (23505) — по коду, не по тексту. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const e = error as { code?: unknown; constraint?: unknown } | null;
  if (!e || e.code !== '23505') return false;
  return constraint === undefined || e.constraint === constraint;
}
