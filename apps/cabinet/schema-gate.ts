import { assertSchemaCurrent } from '@broker/db';

/**
 * Гейт схемы кабинета, вынесенный ОТДЕЛЬНЫМ модулем (починка 25.10).
 *
 * **Почему не в `instrumentation.ts`.** Next собирает этот файл для
 * двух рантаймов, в том числе edge, а `pg` тянет `path` и `fs`,
 * которых в edge нет. Проверка `NEXT_RUNTIME !== 'nodejs'` внутри
 * функции — **рантаймовая**, и сборщик edge-пакета всё равно шёл в
 * `pg` по `await import('pg')`. Production-сборка кабинета падала:
 * `Module not found: Can't resolve 'path'`.
 *
 * Правильный приём лежал строкой ниже в том же файле: Sentry
 * подключается `await import('./sentry.server.config')` **внутри**
 * ветки `NEXT_RUNTIME === 'nodejs'`. Там условие вычисляется на
 * сборке, и в edge-пакет модуль не попадает вовсе.
 *
 * Я написал новое вместо того, чтобы посмотреть на соседние четыре
 * строки.
 */
export async function assertSchemaKnown(): Promise<void> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return; // отсутствие адреса — забота другого гейта

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
