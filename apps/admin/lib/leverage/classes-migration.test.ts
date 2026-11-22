import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readTerminalLeverageTables, type Queryable } from '@broker/money';

const DIR = path.resolve(__dirname, '../../../../packages/db/migrations');
const TARGET = '1796310000000_leverage_instrument_classes.sql';

const upOf = (file: string) => readFileSync(path.join(DIR, file), 'utf8').split(/^-- Down Migration/m)[0]!;

describe('миграция классов плеча в категории терминала', () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = new PGlite({ extensions: { pgcrypto } });
    const files = readdirSync(DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const f of files) {
      if (f === TARGET) break;
      await pg.exec(upOf(f));
    }
    await pg.exec(`
      INSERT INTO leverage_portfolio_class_overrides (portfolio_key, instrument_class, leverage) VALUES
        ('standard', 'fx', 100),
        ('standard', 'Metal', 40),
        ('pro', 'FX', 30),
        ('pro', 'forex', 35),
        ('pro', 'commodities', 15),
        ('enc_prime', 'Indices ', 200),
        ('enc_prime', 'stock', 25),
        ('enc_prime', 'energies', 12);
    `);
    await pg.exec(upOf(TARGET));
  });

  afterAll(() => pg.close());

  it('синонимы переведены в категории, задвоенное и непереводимое — в архиве, ничего не потеряно', async () => {
    const live = await pg.query<{ portfolio_key: string; instrument_class: string; leverage: number }>(
      `SELECT portfolio_key, instrument_class, leverage FROM leverage_portfolio_class_overrides
        ORDER BY portfolio_key, instrument_class`,
    );
    expect(live.rows).toEqual([
      { portfolio_key: 'enc_prime', instrument_class: 'energy', leverage: 12 },
      { portfolio_key: 'enc_prime', instrument_class: 'indices', leverage: 200 },
      { portfolio_key: 'enc_prime', instrument_class: 'stocks', leverage: 25 },
      { portfolio_key: 'pro', instrument_class: 'forex', leverage: 35 },
      { portfolio_key: 'standard', instrument_class: 'crypto', leverage: 10 },
      { portfolio_key: 'standard', instrument_class: 'forex', leverage: 100 },
      { portfolio_key: 'standard', instrument_class: 'metals', leverage: 40 },
    ]);
    const archived = await pg.query<{ portfolio_key: string; instrument_class: string; leverage: number; reason: string }>(
      `SELECT portfolio_key, instrument_class, leverage, reason FROM leverage_portfolio_class_overrides_archive
        ORDER BY portfolio_key, instrument_class`,
    );
    expect(archived.rows).toEqual([
      { portfolio_key: 'pro', instrument_class: 'FX', leverage: 30, reason: 'duplicate_of:forex' },
      { portfolio_key: 'pro', instrument_class: 'commodities', leverage: 15, reason: 'unknown_class' },
    ]);
  });

  it('дальше в таблицу пишутся только шесть категорий', async () => {
    await expect(
      pg.query(`INSERT INTO leverage_portfolio_class_overrides VALUES ('pro', 'fx', 10)`),
    ).rejects.toThrow(/class_check/);
    await pg.query(`INSERT INTO leverage_portfolio_class_overrides VALUES ('pro', 'crypto', 10)`);
  });

  it('после миграции терминал получает таблицу по категориям', async () => {
    const db: Queryable = {
      query: async (sql, params) => {
        const r = await pg.query<Record<string, unknown>>(sql, params as unknown[] | undefined);
        return { rows: r.rows, rowCount: r.rows.length };
      },
    };
    await pg.query(`INSERT INTO users (id, email, password_hash, full_name, locale)
                    VALUES ('00000000-0000-4000-8000-000000000001', 'c@client.test', 'x', 'Клиент', 'ru')`);
    const m = await readTerminalLeverageTables(db, ['00000000-0000-4000-8000-000000000001']);
    expect(m.get('00000000-0000-4000-8000-000000000001')).toEqual({
      leverage: 10,
      base: 20,
      classes: { crypto: 10, forex: 100, metals: 40 },
    });
  });
});
