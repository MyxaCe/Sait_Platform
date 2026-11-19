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

describe('тип счёта при регистрации применяется к клиенту', () => {
  it('выбран Pro — клиент в портфеле pro, плечо терминала 1:50, а не Standard 1:10', async () => {
    const r = await registerUser({ ...INPUT, email: 'pro@example.com', accountType: 'pro' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const row = await db.query(`SELECT portfolio_key FROM client_leverage WHERE user_id = $1`, [r.userId]);
    expect(row.rows[0]?.portfolio_key).toBe('pro');
    expect(await leverageOf(r.userId)).toBe(50);
    const lead = await db.query(`SELECT payload FROM leads WHERE email = 'pro@example.com'`);
    expect((lead.rows[0]?.payload as { accountType: string }).accountType).toBe('pro');
    const welcome = await db.query(`SELECT params FROM notifications WHERE user_id = $1`, [r.userId]);
    expect(welcome.rows[0]?.params).toEqual({ accountType: 'Pro' });
  });

  it('выбран ECN Prime — портфель enc_prime, в заявке CRM прежний код ecn', async () => {
    const r = await registerUser({ ...INPUT, email: 'ecn@example.com', accountType: 'enc_prime' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await leverageOf(r.userId)).toBe(100);
    expect(leadAccountType('enc_prime')).toBe('ecn');
  });

  it('скрытый тип счёта — отказ, клиент не создан', async () => {
    await db.query(`UPDATE leverage_portfolios SET is_public = false WHERE key = 'pro'`);
    const r = await registerUser({ ...INPUT, email: 'hidden@example.com', accountType: 'pro' });
    expect(r).toEqual({ ok: false, reason: 'accountTypeUnavailable' });
    const users = await db.query(`SELECT 1 FROM users WHERE email = 'hidden@example.com'`);
    expect(users.rows).toHaveLength(0);
  });

  it('тип не выбран (портфели не опубликованы) — портфель по умолчанию, без явной строки', async () => {
    const r = await registerUser({ ...INPUT, email: 'none@example.com' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const row = await db.query(`SELECT 1 FROM client_leverage WHERE user_id = $1`, [r.userId]);
    expect(row.rows).toHaveLength(0);
    expect(await leverageOf(r.userId)).toBe(10);
  });
});
