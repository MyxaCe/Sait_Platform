import { assertSchemaCurrent } from '@broker/db';

export async function assertSchemaKnown(): Promise<void> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return;

  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const state = await assertSchemaCurrent(pool as never);
    if (state.ahead.length > 0) {
      console.warn(`[cabinet] схема опережает код: ${state.ahead.join(', ')}`);
    }
    console.info(`[cabinet] схема: применено ${state.applied.length}`);
  } catch (error) {
    console.error(`[cabinet] ${(error as Error).message}`);
    process.exit(1);
  } finally {
    await pool.end().catch(() => {});
  }
}
