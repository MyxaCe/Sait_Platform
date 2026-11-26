import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clientsOfPortfolio, readTerminalLeverageTables, type Queryable } from '@broker/money';
import { FakeTerminal } from '@broker/money/testing';
import { createTestDb, seedUser, type TestDb } from '@broker/support/testing';
import { setClientPortfolio } from './client';
import { runTierTick, ACCOUNT_TIER_OPERATOR_ID } from './tier-worker';
import { setPortfolioMinBalance } from './portfolio';
import type { LeverageTerminalSync } from './terminal-sync';

const ADMIN = '00000000-0000-4000-8000-0000000000a1';

let db: TestDb;
let terminal: FakeTerminal;

function deps() {
  const sync: LeverageTerminalSync = {
    read: readTerminalLeverageTables,
    usersOfPortfolio: clientsOfPortfolio,
    terminal: terminal as never,
  };
  return {
    db: db as unknown as Queryable,
    pool: db as never,
    terminal,
    setPortfolio: (input: Parameters<typeof setClientPortfolio>[0]) => setClientPortfolio(input, db as never, sync),
  };
}

async function client(balanceMinor: number): Promise<string> {
  const id = await seedUser(db);
  await db.query(`UPDATE users SET activated_at = now() WHERE id = $1`, [id]);
  terminal.balances.set(id, balanceMinor);
  return id;
}

let hashN = 0;
async function credit(userId: string, minor: number): Promise<void> {
  const hash = (++hashN).toString(16).padStart(64, '0');
  await db.query(
    `INSERT INTO crypto_deposits (user_id, tx_hash, status, amount_minor, credited_at) VALUES ($1, $2, 'credited', $3, now())`,
    [userId, hash, minor],
  );
}

async function portfolioOf(userId: string): Promise<string | null> {
  const r = await db.query(`SELECT portfolio_key FROM client_leverage WHERE user_id = $1`, [userId]);
  return (r.rows[0]?.portfolio_key as string | undefined) ?? null;
}

beforeEach(async () => {
  db = await createTestDb();
  terminal = new FakeTerminal();
  await db.query(
    `INSERT INTO operators (id, login, display_name, role) VALUES ($1, 'admin-t', 'Админ', 'admin')`,
    [ADMIN],
  );
  for (const [key, min] of [['enc_prime', 5_000_000], ['pro', 500_000]] as const) {
    const r = await setPortfolioMinBalance({ operatorId: ADMIN, portfolioKey: key, minBalanceMinor: min, reason: 'тест' }, db as never);
    expect(r.ok).toBe(true);
  }
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.close();
});

describe('автоповышение типа счёта по балансу', () => {
  it('зачислено пополнение, баланс ≥ порога Pro → Pro, журнал от system:account-tier, плечо доставлено в терминал один раз, уведомление', async () => {
    const id = await client(600_000);
    await credit(id, 600_000);
    const r = await runTierTick(deps());
    expect(r.upgraded).toBe(1);
    expect(await portfolioOf(id)).toBe('pro');
    const j = await db.query(
      `SELECT operator_id, payload FROM admin_action_journal WHERE action = 'leverage.client_portfolio_set' AND subject_id = $1`,
      [id],
    );
    expect(j.rows).toHaveLength(1);
    expect(j.rows[0]?.operator_id).toBe(ACCOUNT_TIER_OPERATOR_ID);
    expect(String((j.rows[0]?.payload as { basis: string }).basis)).toContain('повышен автоматически');
    expect(terminal.leverageCalls.filter((c) => c.userId === id && c.kind === 'real').length).toBeLessThanOrEqual(1);
    expect(terminal.leverageCalls.some((c) => c.userId === id)).toBe(true);
    const n = await db.query(`SELECT type, params FROM notifications WHERE user_id = $1`, [id]);
    expect(n.rows.map((x) => x.type)).toEqual(['accountTierUpgraded']);
    expect(n.rows[0]?.params).toEqual({ accountType: 'Pro' });

    // Повторный такт без новых пополнений ничего не делает.
    const before = terminal.leverageCalls.length;
    const again = await runTierTick(deps());
    expect(again.upgraded).toBe(0);
    expect(terminal.leverageCalls.length).toBe(before);
  });

  it('баланс ниже порога — остаётся в портфеле по умолчанию, отметка проверки ставится', async () => {
    const id = await client(100_000);
    await credit(id, 100_000);
    const r = await runTierTick(deps());
    expect(r.upgraded).toBe(0);
    expect(await portfolioOf(id)).toBeNull();
    const u = await db.query(`SELECT tier_checked_at FROM users WHERE id = $1`, [id]);
    expect(u.rows[0]?.tier_checked_at).not.toBeNull();
  });

  it('понижения нет: клиент на ENC Prime с упавшим балансом остаётся на ENC Prime', async () => {
    const id = await client(6_000_000);
    await credit(id, 6_000_000);
    await runTierTick(deps());
    expect(await portfolioOf(id)).toBe('enc_prime');
    terminal.balances.set(id, 10_000);
    await credit(id, 1);
    const r = await runTierTick(deps());
    expect(r.upgraded).toBe(0);
    expect(await portfolioOf(id)).toBe('enc_prime');
  });

  it('терминал не ответил — ничего не меняется, отметки нет, повтор в следующем такте', async () => {
    const id = await client(600_000);
    await credit(id, 600_000);
    terminal.accountsUnavailable = true;
    const r = await runTierTick(deps());
    expect(r.skipped).toBe(1);
    expect(await portfolioOf(id)).toBeNull();
    terminal.accountsUnavailable = false;
    expect((await runTierTick(deps())).upgraded).toBe(1);
  });

  it('без подтверждённой почты и без пополнений клиент не проверяется', async () => {
    const id = await seedUser(db);
    terminal.balances.set(id, 9_000_000);
    const r = await runTierTick(deps());
    expect(r).toEqual({ checked: 0, upgraded: 0, skipped: 0 });
  });
});

describe('порог в админке', () => {
  it('порог у портфеля по умолчанию ≠ 0 — отказ; лесенка нарушена — отказ; журнал пишется', async () => {
    expect(
      await setPortfolioMinBalance({ operatorId: ADMIN, portfolioKey: 'standard', minBalanceMinor: 1, reason: 'x' }, db as never),
    ).toEqual({ ok: false, reason: 'defaultNotZero' });
    expect(
      await setPortfolioMinBalance({ operatorId: ADMIN, portfolioKey: 'enc_prime', minBalanceMinor: 1_000, reason: 'x' }, db as never),
    ).toEqual({ ok: false, reason: 'notMonotonic', lower: 'pro', higher: 'enc_prime' });
    const j = await db.query(`SELECT count(*)::int AS n FROM admin_action_journal WHERE action = 'leverage.portfolio_min_balance_set'`);
    expect(j.rows[0]?.n).toBe(2);
  });
});
