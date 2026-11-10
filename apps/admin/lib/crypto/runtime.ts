import {
  createTerminalMoneyClient,
  isUsableExchangeAddress,
  terminalMoneyClientFromEnv,
  type PoolLike,
  type TerminalMoneyClient,
  type AccountsOutcome,
} from '@broker/money';
import type { OperatorRole } from '../auth/session';
import { canAccessSection } from '@/components/shell/sections';
import { getPool } from '../db';
import { devFixtureAccounts, devTerminalFixtureEnabled } from './dev-terminal-fixture';

/**
 * Связка админки с `@broker/money`: пул в форме пакета и клиент терминала из
 * окружения (`TERMINAL_INTERNAL_URL`, `INTERNAL_MONEY_TOKEN`, `SITE_SLUG`).
 */
export function moneyPool(): PoolLike {
  return getPool() as unknown as PoolLike;
}

type FullClient = ReturnType<typeof createTerminalMoneyClient>;

const store = globalThis as unknown as { __adminTerminalMoney?: FullClient };

export function terminalMoney(): FullClient {
  store.__adminTerminalMoney ??= terminalMoneyClientFromEnv();
  return store.__adminTerminalMoney;
}

/** Деньги (депозиты/выводы/флаги клиента): admin и finance_operator, без второго аппрува. */
export function canOperateMoney(role: OperatorRole | undefined | null): boolean {
  // Тот же список, что раздел «Деньги» в матрице (components/shell/sections.ts).
  return canAccessSection(role, 'money');
}

/** Адрес кошелька биржи — из env, в админке только для чтения (дизайн §3). */
export function exchangeTronAddress(): string | null {
  const v = process.env.EXCHANGE_TRON_ADDRESS?.trim();
  // Адрес контракта USDT — не кошелёк: показывать его как реквизиты нельзя.
  return v && isUsableExchangeAddress(v) ? v : null;
}

const readerStore = globalThis as unknown as { __adminTerminalReader?: FullClient };

/**
 * Клиент для ЧТЕНИЯ (`GET …/accounts`) с коротким таймаутом: карточка не
 * должна висеть 8 секунд, если терминал лежит (у терминала свой failure domain).
 */
export function terminalReader(): FullClient {
  readerStore.__adminTerminalReader ??= createTerminalMoneyClient({
    baseUrl: process.env.TERMINAL_INTERNAL_URL,
    token: process.env.INTERNAL_MONEY_TOKEN,
    tenant: process.env.SITE_SLUG,
    timeoutMs: 2_500,
  });
  // Dev-фикстура чтения счетов (только next dev + явный флаг; см. файл фикстуры).
  if (devTerminalFixtureEnabled()) {
    return { ...readerStore.__adminTerminalReader, accounts: devFixtureAccounts };
  }
  return readerStore.__adminTerminalReader;
}
