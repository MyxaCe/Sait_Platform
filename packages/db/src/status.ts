import { Pool } from 'pg';
import { readSchemaState, SchemaUnknownError } from './schema-check';

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url || url.trim().length === 0) {
    console.error('DATABASE_URL не задан — спросить состояние не у чего');
    return 2;
  }

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const state = await readSchemaState(pool as never);

    console.log(`применено: ${state.applied.length} из ${state.applied.length + state.missing.length}`);
    for (const name of state.applied) console.log(`  + ${name}`);
    for (const name of state.missing) console.log(`  ОТСУТСТВУЕТ ${name}`);
    for (const name of state.ahead) console.log(`  опережает ${name} (этот код о нём не знает)`);

    if (state.missing.length > 0) {
      console.error(`схема ОТСТАЛА на ${state.missing.length}`);
      return 1;
    }
    console.log('схема соответствует коду');
    return 0;
  } catch (error) {
    if (error instanceof SchemaUnknownError) {
      console.error(error.message);
      return 3;
    }
    throw error;
  } finally {
    await pool.end();
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error('состояние схемы выяснить не удалось:', error);
    process.exit(3);
  },
);
