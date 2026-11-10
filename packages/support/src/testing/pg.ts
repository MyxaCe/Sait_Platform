import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import type { PoolLike, Queryable, TxClient } from '@broker/money';

/**
 * Настоящий Postgres в процессе теста (PGlite, WASM): применяются ВСЕ
 * миграции `packages/db/migrations` по порядку — тест видит ту же схему,
 * те же CHECK, триггеры неизменяемости и уникальности, что прод. Подделка
 * SQL-ответов здесь не годится: проверяем именно запросы (роль без денег —
 * «на уровне запросов, а не UI»).
 *
 * Одно соединение: транзакции тестов идут последовательно, `connect()`
 * отдаёт ту же базу. Каждый запрос пишется в `log` — тест может проверить,
 * какие колонки читались.
 */
const MIGRATIONS = path.resolve(__dirname, '../../../db/migrations');

export interface TestDb extends PoolLike {
  pg: PGlite;
  log: string[];
  close(): Promise<void>;
}

let template: Promise<Blob> | null = null;

async function migratedDump(): Promise<Blob> {
  const pg = new PGlite({ extensions: { pgcrypto } });
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const f of files) {
    await pg.exec(readFileSync(path.join(MIGRATIONS, f), 'utf8'));
  }
  const dump = await pg.dumpDataDir('none');
  await pg.close();
  return dump instanceof Blob ? dump : new Blob([dump]);
}

export async function createTestDb(): Promise<TestDb> {
  template ??= migratedDump();
  const pg = new PGlite({ extensions: { pgcrypto }, loadDataDir: await template });
  const log: string[] = [];
  const query: Queryable['query'] = async (sql, params) => {
    log.push(sql);
    const r = await pg.query<Record<string, unknown>>(sql, params as unknown[] | undefined);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  };
  const client: TxClient = { query, release: () => {} };
  return {
    pg,
    log,
    query,
    connect: async () => client,
    close: () => pg.close(),
  };
}

/** Клиент + оператор для тестов. */
export async function seedUser(
  db: Queryable,
  opts: { id?: string; email?: string; name?: string; locale?: string } = {},
): Promise<string> {
  const id = opts.id ?? crypto.randomUUID();
  await db.query(
    `INSERT INTO users (id, email, password_hash, full_name, locale) VALUES ($1, $2, 'x', $3, $4)`,
    [id, opts.email ?? `${id.slice(0, 8)}@client.test`, opts.name ?? 'Анна Клиентова', opts.locale ?? 'ru'],
  );
  return id;
}

export async function seedOperator(
  db: Queryable,
  role: 'admin' | 'operator' | 'finance_operator' | 'support_operator',
  login = `${role}-${Math.random().toString(36).slice(2, 7)}`,
): Promise<string> {
  const r = await db.query(
    `INSERT INTO operators (login, display_name, role) VALUES ($1, $2, $3) RETURNING id`,
    [login, `Оператор ${login}`, role],
  );
  return String(r.rows[0]!.id);
}
