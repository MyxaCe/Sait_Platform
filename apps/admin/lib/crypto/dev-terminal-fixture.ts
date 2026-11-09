import type { AccountsOutcome } from '@broker/money';
import { getPool } from '../db';

/**
 * DEV-ФИКСТУРА живых цифр терминала (`GET …/accounts`) — ТОЛЬКО для локального
 * просмотра карточки клиента (скриншоты редизайна), когда терминала нет.
 *
 * Fail-closed, два независимых условия, оба обязательны:
 *   1) `NODE_ENV === 'development'` (только `next dev`; любая сборка — production);
 *   2) `ADMIN_DEV_TERMINAL_FIXTURE === '1'`.
 * Иначе `enabled()` = false и используется настоящий клиент терминала. Фикстура
 * подменяет ТОЛЬКО чтение `accounts`; движения денег (deposit/withdraw/freeze)
 * всегда идут в настоящий клиент — фикстура не может «провести» деньги.
 *
 * Цифры не выдуманы из воздуха: баланс — из проекции (`real_accounts`/
 * `demo_accounts`), к нему детерминированный плавающий P&L по id клиента.
 */
export function devTerminalFixtureEnabled(): boolean {
  return process.env.NODE_ENV === 'development' && process.env.ADMIN_DEV_TERMINAL_FIXTURE === '1';
}

function floating(userId: string, balance: number): number {
  let h = 0;
  for (const ch of userId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return Math.round(balance * (((h % 900) - 300) / 10_000));
}

export async function devFixtureAccounts(userId: string): Promise<AccountsOutcome> {
  if (!devTerminalFixtureEnabled()) return { state: 'unavailable', reason: 'not-configured' };
  const r = await getPool().query(
    `SELECT (SELECT balance_cents FROM real_accounts WHERE user_id = $1) AS real,
            (SELECT balance_cents FROM demo_accounts WHERE user_id = $1) AS demo,
            (SELECT frozen FROM client_money_flags WHERE user_id = $1) AS frozen`,
    [userId],
  );
  const row = r.rows[0] as { real: string | null; demo: string | null; frozen: boolean | null };
  const make = (kind: 'real' | 'demo', bal: string | null) => {
    if (bal === null) {
      return {
        kind,
        accountId: null,
        opened: false,
        currency: kind === 'real' ? 'USDT' : 'USD',
        balanceMinor: null,
        equityMinor: null,
        freeMarginMinor: null,
        usedMarginMinor: null,
        openPositions: null,
        tradingFrozen: false,
        leverage: null,
      };
    }
    const b = Number(bal);
    const equity = b + floating(userId + kind, b);
    const used = Math.round(equity * 0.18);
    return {
      kind,
      accountId: `${kind}-${userId.slice(0, 8)}`,
      opened: true,
      currency: kind === 'real' ? 'USDT' : 'USD',
      balanceMinor: b,
      equityMinor: equity,
      freeMarginMinor: equity - used,
      usedMarginMinor: used,
      openPositions: null,
      tradingFrozen: kind === 'real' && Boolean(row.frozen),
      leverage: 20,
    };
  };
  return { state: 'ok', accounts: [make('real', row.real), make('demo', row.demo)] };
}
