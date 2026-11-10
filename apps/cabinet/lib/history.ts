import { getPool } from './db';
import { realMoneyCurrency } from '@broker/money/display-currency';

/**
 * История счёта (r2): сделки из проекции терминала (`{demo,real}_trades`,
 * `{demo,real}_positions` — их пишет consumer из событий терминала) за период.
 * Только чтение, только по userId из СЕССИИ. Имя таблицы — из закрытого
 * списка, не из ввода.
 */

export type AccountKind = 'demo' | 'real';
export type Period = '7d' | '30d' | '90d' | 'all';
export const PERIODS: readonly Period[] = ['7d', '30d', '90d', 'all'];

const TABLES: Record<AccountKind, { trades: string; positions: string; accounts: string }> = {
  demo: { trades: 'demo_trades', positions: 'demo_positions', accounts: 'demo_accounts' },
  real: { trades: 'real_trades', positions: 'real_positions', accounts: 'real_accounts' },
};

const DAY = 86_400_000;
/** Предел строк ленты за период — защита страницы, а не бизнес-правило. */
export const TRADES_LIMIT = 500;

export function parsePeriod(v: string | undefined): Period {
  return (PERIODS as readonly string[]).includes(v ?? '') ? (v as Period) : '30d';
}

/** Начало периода; `null` — за всё время. */
export function periodStart(period: Period, now: Date = new Date()): Date | null {
  const days = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : null;
  return days === null ? null : new Date(now.getTime() - days * DAY);
}

export interface TradeRow {
  id: string;
  tradeId: string;
  symbol: string;
  side: 'buy' | 'sell';
  volume: number;
  price: number;
  /** Зафиксированный P&L закрывающей сделки; `null` — открытие позиции. */
  realizedPnlCents: number | null;
  executedAt: Date;
}

export interface PositionRow {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  volume: number;
  entryPrice: number;
  updatedAt: Date;
}

export interface TradeSummary {
  trades: number;
  /** Оборот: Σ объём × цена, в минорных единицах валюты счёта. */
  turnoverMinor: number;
  /** Зафиксированный P&L за период. */
  pnlMinor: number;
  /** Закрывающих сделок (у них есть P&L) — база винрейта. */
  closed: number;
  wins: number;
  /** Доля прибыльных закрытий, 0..1; `null` — закрытий не было. */
  winRate: number | null;
}

/** Сводка по сделкам периода — чистая функция (тест `history.test.ts`). */
export function summarizeTrades(rows: readonly Pick<TradeRow, 'volume' | 'price' | 'realizedPnlCents'>[]): TradeSummary {
  let turnover = 0;
  let pnl = 0;
  let closed = 0;
  let wins = 0;
  for (const r of rows) {
    turnover += Math.round(r.volume * r.price * 100);
    if (r.realizedPnlCents !== null) {
      closed += 1;
      pnl += r.realizedPnlCents;
      if (r.realizedPnlCents > 0) wins += 1;
    }
  }
  return {
    trades: rows.length,
    turnoverMinor: turnover,
    pnlMinor: pnl,
    closed,
    wins,
    winRate: closed === 0 ? null : wins / closed,
  };
}

function side(v: unknown): 'buy' | 'sell' {
  return v === 'sell' ? 'sell' : 'buy';
}

export interface AccountHistory {
  currency: string;
  /** Счёт открыт (есть строка проекции). */
  opened: boolean;
  trades: TradeRow[];
  positions: PositionRow[];
}

export async function getAccountHistory(userId: string, kind: AccountKind, period: Period): Promise<AccountHistory> {
  const t = TABLES[kind];
  const since = periodStart(period);
  const db = getPool();
  const [acc, trades, positions] = await Promise.all([
    db.query(`SELECT currency FROM ${t.accounts} WHERE user_id = $1`, [userId]),
    db.query(
      `SELECT id, trade_id, symbol, side, volume, price, realized_pnl_cents, executed_at
         FROM ${t.trades}
        WHERE user_id = $1 AND ($2::timestamptz IS NULL OR executed_at >= $2)
        ORDER BY executed_at DESC
        LIMIT ${TRADES_LIMIT}`,
      [userId, since],
    ),
    db.query(
      `SELECT id, symbol, side, volume, entry_price, updated_at
         FROM ${t.positions} WHERE user_id = $1 ORDER BY updated_at DESC`,
      [userId],
    ),
  ]);
  const accRow = acc.rows[0] as { currency?: string } | undefined;
  return {
    currency: kind === 'real' ? realMoneyCurrency(accRow?.currency) : (accRow?.currency ?? 'USD'),
    opened: Boolean(accRow),
    trades: trades.rows.map((r) => ({
      id: r.id as string,
      tradeId: r.trade_id as string,
      symbol: r.symbol as string,
      side: side(r.side),
      volume: Number(r.volume),
      price: Number(r.price),
      realizedPnlCents: r.realized_pnl_cents === null ? null : Number(r.realized_pnl_cents),
      executedAt: r.executed_at as Date,
    })),
    positions: positions.rows.map((p) => ({
      id: p.id as string,
      symbol: p.symbol as string,
      side: side(p.side),
      volume: Number(p.volume),
      entryPrice: Number(p.entry_price),
      updatedAt: p.updated_at as Date,
    })),
  };
}
