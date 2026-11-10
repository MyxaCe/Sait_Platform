import { getPool, type Queryable } from '../db';
import type { PortfolioLeverage, ClientLeverageOverride } from './resolve';

/**
 * Чтения зоны «Риск/плечо» (Р-446, §3.8/3.9). Серверные компоненты читают
 * базу напрямую; чтения НЕ журналируются (журналируем только изменяющее).
 */

/** Портфель + его class-override'ы + сколько клиентов в нём (для §3.9). */
export interface PortfolioRow extends PortfolioLeverage {
  readonly isDefault: boolean;
  readonly clientCount: number;
  /** Тариф портфеля (б.п., 0..500) и условия типа счёта для /accounts. */
  readonly markupBps: number;
  readonly commissionBps: number;
  readonly instruments: string | null;
  readonly description: string | null;
}

function asDenominator(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    // База/планка плеча вне [1, …] — это не «0 по умолчанию», а испорченная
    // строка; лучше громко упасть, чем тихо выдать бессмысленное плечо.
    throw new Error(`плечо должно быть целым ≥ 1, получено: ${String(value)}`);
  }
  return n;
}

/** Ставка тарифа (б.п.): колонка NOT NULL 0..500; иное — испорченная строка, громко. */
function asBps(value: unknown): number {
  const n = Number(value);
  if (value === null || value === undefined || !Number.isInteger(n) || n < 0) {
    throw new Error(`ставка тарифа должна быть целым ≥ 0, получено: ${String(value)}`);
  }
  return n;
}

/**
 * Все портфели с планками по классам и числом клиентов. Один проход: портфели
 * слева, class-override'ы и счётчик клиентов — агрегатами, чтобы не ходить в
 * базу по разу на портфель.
 */
export async function listPortfolios(db: Queryable = getPool()): Promise<PortfolioRow[]> {
  const portfolios = await db.query(
    `SELECT p.key, p.title, p.base_leverage, p.is_default, p.sort_order,
            p.markup_bps, p.commission_bps, p.instruments, p.description,
            COALESCE(c.cnt, 0) AS client_count
       FROM leverage_portfolios p
       LEFT JOIN (
            SELECT portfolio_key, COUNT(*)::int AS cnt
              FROM client_leverage GROUP BY portfolio_key
       ) c ON c.portfolio_key = p.key
      ORDER BY p.sort_order, p.key`,
  );

  const overrides = await db.query(
    `SELECT portfolio_key, instrument_class, leverage
       FROM leverage_portfolio_class_overrides`,
  );

  const byPortfolio = new Map<string, Record<string, number>>();
  for (const row of overrides.rows) {
    const key = String(row.portfolio_key);
    const map = byPortfolio.get(key) ?? {};
    map[String(row.instrument_class)] = asDenominator(row.leverage);
    byPortfolio.set(key, map);
  }

  return portfolios.rows.map((row) => ({
    key: String(row.key),
    title: String(row.title),
    baseLeverage: asDenominator(row.base_leverage),
    classOverrides: byPortfolio.get(String(row.key)) ?? {},
    isDefault: Boolean(row.is_default),
    clientCount: Number(row.client_count ?? 0),
    markupBps: asBps(row.markup_bps),
    commissionBps: asBps(row.commission_bps),
    instruments: row.instruments === null || row.instruments === undefined ? null : String(row.instruments),
    description: row.description === null || row.description === undefined ? null : String(row.description),
  }));
}

/** Один портфель по ключу (для резолва/снимка), или `null`. */
export async function getPortfolio(
  key: string,
  db: Queryable = getPool(),
): Promise<PortfolioLeverage | null> {
  const all = await listPortfolios(db);
  return all.find((p) => p.key === key) ?? null;
}

/** Плечо одного клиента: портфель, override (если есть), «сырой» ряд. */
export interface ClientLeverageView {
  readonly userId: string;
  readonly portfolioKey: string;
  readonly override: (ClientLeverageOverride & { byName: string | null; at: string }) | null;
}

/**
 * Плечо клиента. Строки может ещё не быть (клиент не привязан явно) — тогда
 * `null`: вызывающий показывает портфель по умолчанию. Строку заводит первое
 * назначение портфеля/override оператором.
 */
export async function getClientLeverage(
  userId: string,
  db: Queryable = getPool(),
): Promise<ClientLeverageView | null> {
  const res = await db.query(
    `SELECT cl.user_id, cl.portfolio_key,
            cl.override_leverage, cl.override_reason, cl.override_ticket, cl.override_at,
            o.display_name AS override_by_name
       FROM client_leverage cl
       LEFT JOIN operators o ON o.id = cl.override_by
      WHERE cl.user_id = $1`,
    [userId],
  );
  const row = res.rows[0];
  if (!row) return null;

  const hasOverride = row.override_leverage !== null && row.override_leverage !== undefined;
  return {
    userId: String(row.user_id),
    portfolioKey: String(row.portfolio_key),
    override: hasOverride
      ? {
          leverage: asDenominator(row.override_leverage),
          reason: String(row.override_reason ?? ''),
          ticket: String(row.override_ticket ?? ''),
          byName: (row.override_by_name as string | null) ?? null,
          at: new Date(String(row.override_at)).toISOString(),
        }
      : null,
  };
}

/** Ключ портфеля по умолчанию (новый клиент попадает в него). */
export async function getDefaultPortfolioKey(db: Queryable = getPool()): Promise<string | null> {
  const res = await db.query(
    `SELECT key FROM leverage_portfolios WHERE is_default ORDER BY key LIMIT 1`,
  );
  return res.rows[0] ? String(res.rows[0].key) : null;
}
