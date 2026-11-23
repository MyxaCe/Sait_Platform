import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  lockWithdrawModeWithinTx,
  readClientWithdrawManualOnly,
  readWithdrawMode,
  type Queryable,
} from '@broker/money';

const DIR = path.resolve(__dirname, '../../../../packages/db/migrations');
const TARGET = '1796410000000_withdraw_modes.sql';

const upOf = (file: string) => readFileSync(path.join(DIR, file), 'utf8').split(/^-- Down Migration/m)[0]!;

describe('миграция режимов вывода', () => {
  let pg: PGlite;
  let db: Queryable;

  beforeAll(async () => {
    pg = new PGlite({ extensions: { pgcrypto } });
    const files = readdirSync(DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    expect(files).toContain(TARGET);
    for (const f of files) {
      await pg.exec(upOf(f));
      if (f === TARGET) break;
    }
    db = {
      query: async (sql: string, params?: unknown[]) => {
        const r = await pg.query<Record<string, unknown>>(sql, params as unknown[] | undefined);
        return { rows: r.rows, rowCount: r.affectedRows ?? null };
      },
    };
  });

  afterAll(() => pg.close());

  it('по умолчанию «Ручной», строка настроек есть', async () => {
    expect(await readWithdrawMode(db)).toEqual({ mode: 'manual', changedAt: null, changedBy: null, changedByLogin: null });
  });

  it('режим проверяется ограничением базы', async () => {
    await expect(db.query(`UPDATE platform_money_settings SET withdraw_mode = 'turbo' WHERE id = 1`)).rejects.toThrow();
    await db.query(`UPDATE platform_money_settings SET withdraw_mode = 'stop' WHERE id = 1`);
    expect((await readWithdrawMode(db)).mode).toBe('stop');
  });

  it('чтение под блокировкой работает внутри транзакции', async () => {
    await pg.exec('BEGIN');
    try {
      expect(await lockWithdrawModeWithinTx(db)).toBe('stop');
    } finally {
      await pg.exec('ROLLBACK');
    }
  });

  it('флаг клиента «только ручной вывод» по умолчанию выключен', async () => {
    const u = await db.query(
      `INSERT INTO users (id, email, full_name, password_hash) VALUES (gen_random_uuid(), 'wd-mode@example.test', 'Тест', 'x') RETURNING id`,
    );
    const userId = u.rows[0]!.id as string;
    expect(await readClientWithdrawManualOnly(db, userId)).toBe(false);
    await db.query(`INSERT INTO client_money_flags (user_id) VALUES ($1)`, [userId]);
    const r = await db.query(`SELECT withdraw_manual_only FROM client_money_flags WHERE user_id = $1`, [userId]);
    expect(r.rows[0]!.withdraw_manual_only).toBe(false);
  });
});
