import { getPool, type Queryable } from '../db';

/**
 * «Счёт и торговля» в карточке клиента (оператор видит деньги).
 *
 * Источник — ПРОЕКЦИЯ торговли в той же базе `broker_site`: `demo_accounts`,
 * `demo_positions`, `demo_trades`. Их пишет `apps/consumer` из событий
 * терминала (`terminal.account.opened` / `balance.changed` / `trade.executed`).
 * Владелец денежного числа — терминал (WEB-29); здесь только чтение отражения,
 * админка в эти таблицы не пишет.
 *
 * **Equity не показываем — его нет в проекции.** Терминал присылает баланс и
 * снимок позиций (символ/сторона/объём/цена входа), но не текущую цену и не
 * плавающий P&L. Посчитать equity здесь значило бы выдумать котировку;
 * честнее назвать баланс балансом, а позиции — по цене входа.
 *
 * Суммы — в минорных единицах (`*_cents`), как в проекции; переводит в
 * рубли/доллары только показ.
 */

export interface TradingAccount {
  balanceCents: number;
  currency: string;
  openedAt: string;
}

export interface TradingPosition {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  volume: number;
  entryPrice: number;
  updatedAt: string;
}

export interface TradingTrade {
  id: string;
  tradeId: string;
  symbol: string;
  side: 'buy' | 'sell';
  volume: number;
  price: number;
  /** `null` — сделка открытия (реализованного результата у неё нет). */
  realizedPnlCents: number | null;
  executedAt: string;
}

export interface ClientTrading {
  /** `null` — счёт ещё не открыт терминалом (событие `account.opened` не пришло). */
  account: TradingAccount | null;
  positions: TradingPosition[];
  /** Последние сделки, новые сверху (не больше `RECENT_TRADES_LIMIT`). */
  recentTrades: TradingTrade[];
  tradesTotal: number;
  /** Сумма реализованного P&L по ВСЕМ сделкам клиента. */
  realizedPnlTotalCents: number;
  /** Последняя торговая активность: сделка или обновление снимка позиций. */
  lastActivityAt: string | null;
}

export const RECENT_TRADES_LIMIT = 20;

function iso(value: unknown): string {
  return new Date(value as string | Date).toISOString();
}

function asSide(value: unknown): 'buy' | 'sell' {
  // CHECK в схеме держит ровно два значения; иное — сломанная строка.
  if (value === 'buy' || value === 'sell') return value;
  throw new Error(`demo_*.side вне допустимого множества: ${String(value)}`);
}

/**
 * Счёт клиента: `demo` (игрушечные деньги, `demo_*`) или `real` (USDT,
 * `real_*`, миграция 1794700000000). Таблицы параллельные — имя выбирается из
 * закрытого списка, а не склеивается из ввода.
 */
export type AccountKind = 'demo' | 'real';
const TABLES: Record<AccountKind, { accounts: string; positions: string; trades: string }> = {
  demo: { accounts: 'demo_accounts', positions: 'demo_positions', trades: 'demo_trades' },
  real: { accounts: 'real_accounts', positions: 'real_positions', trades: 'real_trades' },
};

export async function getClientTrading(
  userId: string,
  db: Queryable = getPool(),
  kind: AccountKind = 'demo',
): Promise<ClientTrading> {
  const t = TABLES[kind];
  const [account, positions, trades, totals] = await Promise.all([
    db.query(
      `SELECT balance_cents, currency, created_at FROM ${t.accounts} WHERE user_id = $1`,
      [userId],
    ),
    db.query(
      `SELECT id, symbol, side, volume, entry_price, updated_at
         FROM ${t.positions} WHERE user_id = $1
        ORDER BY updated_at DESC, symbol ASC`,
      [userId],
    ),
    db.query(
      `SELECT id, trade_id, symbol, side, volume, price, realized_pnl_cents, executed_at
         FROM ${t.trades} WHERE user_id = $1
        ORDER BY executed_at DESC
        LIMIT ${RECENT_TRADES_LIMIT}`,
      [userId],
    ),
    db.query(
      `SELECT count(*) AS trades_total,
              COALESCE(sum(realized_pnl_cents), 0) AS pnl_total,
              max(executed_at) AS last_trade_at,
              (SELECT max(updated_at) FROM ${t.positions} WHERE user_id = $1) AS last_position_at
         FROM ${t.trades} WHERE user_id = $1`,
      [userId],
    ),
  ]);

  const a = account.rows[0];
  const tot = totals.rows[0] ?? {};
  const lastTrade = tot.last_trade_at ? new Date(tot.last_trade_at as string | Date) : null;
  const lastPos = tot.last_position_at ? new Date(tot.last_position_at as string | Date) : null;
  const last =
    lastTrade && lastPos ? (lastTrade > lastPos ? lastTrade : lastPos) : (lastTrade ?? lastPos);

  return {
    account: a
      ? {
          balanceCents: Number(a.balance_cents),
          currency: (a.currency as string) ?? 'USD',
          openedAt: iso(a.created_at),
        }
      : null,
    positions: positions.rows.map((p) => ({
      id: p.id as string,
      symbol: p.symbol as string,
      side: asSide(p.side),
      volume: Number(p.volume),
      entryPrice: Number(p.entry_price),
      updatedAt: iso(p.updated_at),
    })),
    recentTrades: trades.rows.map((r) => ({
      id: r.id as string,
      tradeId: r.trade_id as string,
      symbol: r.symbol as string,
      side: asSide(r.side),
      volume: Number(r.volume),
      price: Number(r.price),
      realizedPnlCents:
        r.realized_pnl_cents === null || r.realized_pnl_cents === undefined
          ? null
          : Number(r.realized_pnl_cents),
      executedAt: iso(r.executed_at),
    })),
    tradesTotal: Number(tot.trades_total ?? 0),
    realizedPnlTotalCents: Number(tot.pnl_total ?? 0),
    lastActivityAt: last ? last.toISOString() : null,
  };
}

/** Сумма в минорных единицах → «$12 345.67» (только показ). */
export function formatMoneyCents(cents: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency }).format(cents / 100);
  } catch {
    // Незнакомый код валюты не должен ронять карточку — число важнее значка.
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** P&L со знаком: «+$12.00» / «−$3.50». Ноль без знака. */
export function formatPnlCents(cents: number, currency = 'USD'): string {
  const abs = formatMoneyCents(Math.abs(cents), currency);
  if (cents > 0) return `+${abs}`;
  if (cents < 0) return `−${abs}`;
  return abs;
}
