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

export function moneyPool(): PoolLike {
  return getPool() as unknown as PoolLike;
}

type FullClient = ReturnType<typeof createTerminalMoneyClient>;

const store = globalThis as unknown as { __adminTerminalMoney?: FullClient };

export function terminalMoney(): FullClient {
  store.__adminTerminalMoney ??= terminalMoneyClientFromEnv();
  return store.__adminTerminalMoney;
}

export function canOperateMoney(role: OperatorRole | undefined | null): boolean {
  return canAccessSection(role, 'money');
}

export function exchangeTronAddress(): string | null {
  const v = process.env.EXCHANGE_TRON_ADDRESS?.trim();
  return v && isUsableExchangeAddress(v) ? v : null;
}

const readerStore = globalThis as unknown as { __adminTerminalReader?: FullClient };

export function terminalReader(): FullClient {
  readerStore.__adminTerminalReader ??= createTerminalMoneyClient({
    baseUrl: process.env.TERMINAL_INTERNAL_URL,
    token: process.env.INTERNAL_MONEY_TOKEN,
    tenant: process.env.SITE_SLUG,
    timeoutMs: 2_500,
  });
  if (devTerminalFixtureEnabled()) {
    return { ...readerStore.__adminTerminalReader, accounts: devFixtureAccounts };
  }
  return readerStore.__adminTerminalReader;
}
