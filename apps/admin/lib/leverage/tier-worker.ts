import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { readRealBalanceMinor, type Queryable, type TerminalMoneyClient } from '@broker/money';
import { setClientPortfolio, type ClientLeverageResult, type SetClientPortfolioInput } from './client';
import { formatUsdt, pickUpgrade, type TierPortfolio } from './tier';

/** Служебный оператор журнала автоповышений (миграция 1796600000000). */
export const ACCOUNT_TIER_OPERATOR_ID = '00000000-0000-4000-8000-00000000c0b6';
export const ACCOUNT_TIER_OPERATOR_LOGIN = 'system:account-tier';

/** Сколько клиентов проверяется за один такт: баланс читается из терминала по одному. */
const BATCH = 25;
/** Повторная проверка тех, кто уже пополнял: ловит рост баланса от прибыли, переводов, начислений. */
const RECHECK_INTERVAL = '24 hours';

export interface TierDeps {
  db: Queryable;
  pool: { connect(): Promise<PoolClient> };
  terminal: Pick<TerminalMoneyClient, 'accounts'>;
  setPortfolio?: (input: SetClientPortfolioInput) => Promise<ClientLeverageResult>;
  now?: () => Date;
  log?: (m: string) => void;
}

export interface TierTickResult {
  checked: number;
  upgraded: number;
  skipped: number;
}

export async function loadTierPortfolios(db: Queryable): Promise<TierPortfolio[]> {
  const res = await db.query(
    `SELECT key, title, min_balance_minor, sort_order, is_default, is_public FROM leverage_portfolios`,
  );
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    key: String(r.key),
    title: String(r.title ?? r.key),
    minBalanceMinor: Number(r.min_balance_minor ?? 0),
    sortOrder: Number(r.sort_order ?? 0),
    isDefault: Boolean(r.is_default),
    isPublic: Boolean(r.is_public),
  }));
}

/**
 * Клиенты к проверке: подтверждённая почта и (зачисленное пополнение после
 * прошлой проверки ИЛИ прошлая проверка старше суток при хотя бы одном пополнении).
 */
async function candidates(db: Queryable): Promise<string[]> {
  const res = await db.query(
    `SELECT u.id
       FROM users u
      WHERE u.activated_at IS NOT NULL
        AND EXISTS (SELECT 1 FROM crypto_deposits d WHERE d.user_id = u.id AND d.status = 'credited')
        AND (
          u.tier_checked_at IS NULL
          OR EXISTS (SELECT 1 FROM crypto_deposits d
                      WHERE d.user_id = u.id AND d.status = 'credited' AND d.credited_at > u.tier_checked_at)
          OR u.tier_checked_at < now() - interval '${RECHECK_INTERVAL}'
        )
      ORDER BY u.tier_checked_at NULLS FIRST
      LIMIT ${BATCH}`,
  );
  return (res.rows as { id: string }[]).map((r) => String(r.id));
}

async function currentPortfolio(db: Queryable, userId: string): Promise<string | null> {
  const res = await db.query(`SELECT portfolio_key FROM client_leverage WHERE user_id = $1`, [userId]);
  const row = res.rows[0] as { portfolio_key?: unknown } | undefined;
  return row && typeof row.portfolio_key === 'string' ? row.portfolio_key : null;
}

async function markChecked(db: Queryable, userId: string, at: Date): Promise<void> {
  await db.query(`UPDATE users SET tier_checked_at = $2 WHERE id = $1`, [userId, at.toISOString()]);
}

/** Один проход: прочитать баланс, при достижении порога повысить портфель. Только вверх. */
export async function runTierTick(deps: TierDeps): Promise<TierTickResult> {
  const log = deps.log ?? (() => {});
  const setPortfolio = deps.setPortfolio ?? ((input) => setClientPortfolio(input, deps.pool));
  const out: TierTickResult = { checked: 0, upgraded: 0, skipped: 0 };
  const portfolios = await loadTierPortfolios(deps.db);
  for (const userId of await candidates(deps.db)) {
    // Отметка берётся ДО чтения баланса: зачисление после этого момента попадёт в следующий такт.
    const at = (deps.now ?? (() => new Date()))();
    const balance = await readRealBalanceMinor(deps.terminal, userId);
    if (balance === null) {
      out.skipped++;
      continue; // терминал не ответил — без отметки, повтор в следующем такте
    }
    const current = await currentPortfolio(deps.db, userId);
    const target = pickUpgrade(portfolios, current, balance);
    if (!target) {
      await markChecked(deps.db, userId, at);
      out.checked++;
      continue;
    }
    const reason = `повышен автоматически: баланс ${formatUsdt(balance)} USDT ≥ порог ${formatUsdt(target.minBalanceMinor)} USDT (${target.title})`;
    const result = await setPortfolio({
      operatorId: ACCOUNT_TIER_OPERATOR_ID,
      operatorLogin: ACCOUNT_TIER_OPERATOR_LOGIN,
      userId,
      portfolioKey: target.key,
      reason,
      withinTx: async (db) => {
        await db.query(`INSERT INTO notifications (id, user_id, type, params) VALUES ($1, $2, $3, $4)`, [
          randomUUID(),
          userId,
          'accountTierUpgraded',
          JSON.stringify({ accountType: target.title }),
        ]);
        await markChecked(db, userId, at);
      },
    });
    if (result.ok) {
      out.upgraded++;
      log(`[account-tier] ${userId}: ${current ?? 'по умолчанию'} → ${target.key} (${reason})`);
    } else if (result.reason === 'alreadyInState') {
      await markChecked(deps.db, userId, at);
      out.checked++;
    } else {
      out.skipped++; // терминал отказал/недоступен — повтор в следующем такте
      log(`[account-tier] ${userId}: повышение до ${target.key} отложено (${result.reason})`);
    }
  }
  return out;
}

const store = globalThis as unknown as { __accountTierWorker?: ReturnType<typeof setInterval> };

export function startAccountTierWorker(deps: () => TierDeps): void {
  if (store.__accountTierWorker) return;
  const every = Math.max(5_000, Number(process.env.ACCOUNT_TIER_TICK_MS ?? 30_000) || 30_000);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await runTierTick(deps());
      if (r.upgraded || r.skipped) console.info('[account-tier] такт', r);
    } catch (e) {
      console.error('[account-tier] такт упал', (e as Error).message);
    } finally {
      running = false;
    }
  };
  store.__accountTierWorker = setInterval(tick, every);
  console.info(`[account-tier] тип счёта по балансу: проверка каждые ${every} мс`);
}
