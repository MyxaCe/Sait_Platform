import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readTerminalLeverage, type Queryable } from '@broker/money';
import { createTestDb, type TestDb } from '@broker/support/testing';

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('../db', () => ({ getPool: () => holder.db }));

const { registerUser, leadAccountType } = await import('./register');

let db: TestDb;

const INPUT = {
  firstName: 'Иван',
  lastName: 'Петров',
  phone: '+35725000000',
  country: 'CY',
  password: 'correct horse battery',
  locale: 'ru' as const,
};

beforeEach(async () => {
  db = await createTestDb();
  holder.db = db;
  vi.stubEnv('CMS_API_URL', 'http://cms.test');
  vi.stubEnv('SITE_SLUG', 'apex-ru');
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ demoStartBalanceCents: 1_000_000, instruments: [] })));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await db.close();
});

async function leverageOf(userId: string): Promise<number | undefined> {
  return (await readTerminalLeverage(db as unknown as Queryable, [userId])).get(userId);
}

describe('тип счёта при регистрации не выбирается — все начинают с портфеля по умолчанию', () => {
  it('старая ссылка с accountType=pro — клиент всё равно в портфеле по умолчанию (1:10), без явной строки', async () => {
    const r = await registerUser({ ...INPUT, email: 'pro@example.com', accountType: 'pro' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const row = await db.query(`SELECT 1 FROM client_leverage WHERE user_id = $1`, [r.userId]);
    expect(row.rows).toHaveLength(0);
    expect(await leverageOf(r.userId)).toBe(10);
    const lead = await db.query(`SELECT payload FROM leads WHERE email = 'pro@example.com'`);
    expect((lead.rows[0]?.payload as { accountType: string }).accountType).toBe('standard');
    const def = await db.query(`SELECT title FROM leverage_portfolios WHERE is_default`);
    const welcome = await db.query(`SELECT params FROM notifications WHERE user_id = $1`, [r.userId]);
    expect(welcome.rows[0]?.params).toEqual({ accountType: def.rows[0]?.title });
  });

  it('скрытый тип в ссылке больше не мешает регистрации', async () => {
    await db.query(`UPDATE leverage_portfolios SET is_public = false WHERE key = 'pro'`);
    const r = await registerUser({ ...INPUT, email: 'hidden@example.com', accountType: 'pro' });
    expect(r.ok).toBe(true);
  });

  it('тип не передан — портфель по умолчанию', async () => {
    const r = await registerUser({ ...INPUT, email: 'none@example.com' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await leverageOf(r.userId)).toBe(10);
  });

  it('код типа для заявки CRM по-прежнему переводится (старые записи)', () => {
    expect(leadAccountType('enc_prime')).toBe('ecn');
    expect(leadAccountType(null)).toBe('standard');
  });
});
