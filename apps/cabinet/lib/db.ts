import { Pool } from 'pg';

/** Пул к Postgres платформы (broker_site) — общий failure domain с сайтом (ADR-022). */
const globalStore = globalThis as unknown as { __cabinetPool?: Pool };

export function getPool(): Pool {
  if (!globalStore.__cabinetPool) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL is required for the cabinet (no in-memory fallback: auth needs persistence)');
    }
    globalStore.__cabinetPool = new Pool({ connectionString: url, max: 5 });
  }
  return globalStore.__cabinetPool;
}

export async function pingDatabase(): Promise<'ok' | 'failed'> {
  try {
    await getPool().query('SELECT 1');
    return 'ok';
  } catch {
    return 'failed';
  }
}
