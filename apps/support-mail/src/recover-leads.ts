import 'dotenv/config';

import { Pool } from 'pg';
import type { PoolLike } from '@broker/money';
import { loadSupportSettings, recoverContactLeads } from '@broker/support';
import { readEnv } from '@broker/utils';

/**
 * Разовое восстановление потерянных обращений формы контактов (leads → тикеты).
 * Идемпотентно — можно запускать сколько угодно раз; воркер делает то же
 * самое на старте и раз в 10 минут.
 *
 *   DATABASE_URL=… pnpm --filter @broker/support-mail recover-leads
 */
async function main(): Promise<void> {
  const url = readEnv(process.env.DATABASE_URL);
  if (!url) throw new Error('DATABASE_URL обязателен');
  const pool = new Pool({ connectionString: url, max: 2 });
  try {
    const settings = await loadSupportSettings(pool);
    const r = await recoverContactLeads(pool as unknown as PoolLike, settings);
    console.info(r.recovered > 0 ? `восстановлено: ${r.recovered} (#${r.numbers.join(', #')})` : 'нечего восстанавливать — все обращения уже тикеты');
  } finally {
    await pool.end();
  }
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
