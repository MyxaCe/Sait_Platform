import { Pool } from 'pg';

/**
 * Пул к Postgres платформы (broker_site). Центр управления живёт на ТОЙ ЖЕ
 * базе, что кабинет и сайт (Р-395): операторское действие и строка клиента,
 * которой оно касается, видны в одной транзакции. Отдельная поверхность — не
 * отдельная база.
 *
 * Нет `DATABASE_URL` → бросаем, а не поднимаем пул «в никуда». Вход оператора
 * без базы невозможен по определению (пароли и журнал — в базе), и молчаливый
 * пул дал бы ошибки позже и не там.
 */
const globalStore = globalThis as unknown as { __adminPool?: Pool };

export function getPool(): Pool {
  if (!globalStore.__adminPool) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL обязателен для центра управления (вход и журнал — в базе)');
    }
    globalStore.__adminPool = new Pool({ connectionString: url, max: 5 });
  }
  return globalStore.__adminPool;
}

/** Минимум от драйвера: пул и клиент транзакции им обоим удовлетворяют. */
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}
