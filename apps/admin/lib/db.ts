import { Pool } from 'pg';

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

export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}
