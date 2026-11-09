import {
  createTerminalMoneyClient,
  isValidTronAddress,
  isUsableExchangeAddress,
  resolveMoneyPolicy,
  type AccountsOutcome,
  type MoneyPolicy,
  type PoolLike,
  type TerminalMoneyClient,
} from '@broker/money';
import { getPool } from './db';

/**
 * Деньги кабинета (USDT TRC20, реальный счёт). Только серверный модуль.
 * Политика — общий резолвер `@broker/money` (тот же, что видит оператор).
 * Все чтения — по userId из СЕССИИ.
 */

export function moneyPool(): PoolLike {
  return getPool() as unknown as PoolLike;
}

type FullClient = TerminalMoneyClient & { accounts(userId: string): Promise<AccountsOutcome> };
const store = globalThis as unknown as { __cabinetTerminalMoney?: FullClient; __cabinetTerminalReader?: FullClient };

/** Денежные вызовы (вывод) — обычный таймаут. */
export function terminalMoney(): FullClient {
  store.__cabinetTerminalMoney ??= createTerminalMoneyClient({
    baseUrl: process.env.TERMINAL_INTERNAL_URL,
    token: process.env.INTERNAL_MONEY_TOKEN,
    tenant: process.env.SITE_SLUG,
  });
  return store.__cabinetTerminalMoney;
}

/** Чтение счетов для главной — короткий таймаут: страница не висит, если терминал лежит. */
export function terminalReader(): FullClient {
  store.__cabinetTerminalReader ??= createTerminalMoneyClient({
    baseUrl: process.env.TERMINAL_INTERNAL_URL,
    token: process.env.INTERNAL_MONEY_TOKEN,
    tenant: process.env.SITE_SLUG,
    timeoutMs: 2_000,
  });
  return store.__cabinetTerminalReader;
}

export async function getMoneyPolicy(userId: string): Promise<MoneyPolicy> {
  return resolveMoneyPolicy(userId, moneyPool());
}

/**
 * Адрес кошелька биржи для ввода — ТОЛЬКО из env (подмена адреса ввода —
 * классическая атака; в базе/CMS его нет). Невалидный адрес не показываем
 * вовсе: лучше «ввод недоступен», чем реквизиты, по которым деньги уйдут
 * в никуда.
 */
export function exchangeAddress(): string | null {
  const v = process.env.EXCHANGE_TRON_ADDRESS?.trim();
  return v && isUsableExchangeAddress(v) ? v : null;
}

export interface RealAccountView {
  balanceCents: number;
  currency: string;
}

/** Баланс реального счёта из проекции (`real_accounts`). */
export async function getRealAccount(userId: string): Promise<RealAccountView | null> {
  const r = await getPool().query(`SELECT balance_cents, currency FROM real_accounts WHERE user_id = $1`, [userId]);
  const row = r.rows[0];
  return row ? { balanceCents: Number(row.balance_cents), currency: row.currency as string } : null;
}

export interface DepositView {
  id: string;
  txHash: string;
  status: string;
  amountMinor: number | null;
  rejectReason: string | null;
  claimedAt: Date;
}

export interface WithdrawalView {
  id: string;
  toAddress: string;
  amountMinor: number;
  status: string;
  rejectReason: string | null;
  payoutTxHash: string | null;
  requestedAt: Date;
}

export async function listMyDeposits(userId: string): Promise<DepositView[]> {
  const r = await getPool().query(
    `SELECT id, tx_hash, status, amount_minor, reject_reason, claimed_at
       FROM crypto_deposits WHERE user_id = $1 ORDER BY claimed_at DESC LIMIT 50`,
    [userId],
  );
  return r.rows.map((d) => ({
    id: d.id,
    txHash: d.tx_hash,
    status: d.status,
    amountMinor: d.amount_minor === null ? null : Number(d.amount_minor),
    rejectReason: d.reject_reason,
    claimedAt: d.claimed_at,
  }));
}

export async function listMyWithdrawals(userId: string): Promise<WithdrawalView[]> {
  const r = await getPool().query(
    `SELECT id, to_address, amount_minor, status, reject_reason, payout_tx_hash, requested_at
       FROM crypto_withdrawals WHERE user_id = $1 ORDER BY requested_at DESC LIMIT 50`,
    [userId],
  );
  return r.rows.map((w) => ({
    id: w.id,
    toAddress: w.to_address,
    amountMinor: Number(w.amount_minor),
    status: w.status,
    rejectReason: w.reject_reason,
    payoutTxHash: w.payout_tx_hash,
    requestedAt: w.requested_at,
  }));
}
