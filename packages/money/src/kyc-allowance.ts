import type { Queryable } from './db';
import type { TerminalMoneyClient } from './terminal-money';

export const KYC_ALLOWANCE_COUNTED_STATUSES = ['requested', 'approved', 'sent', 'settled', 'needs_review'] as const;

export interface KycWithdrawUsage {
  usedMinor: number;
  usedDebitedMinor: number;
}

export interface KycAllowance {
  bps: number;
  balanceMinor: number;
  baseMinor: number;
  limitMinor: number;
  usedMinor: number;
  remainingMinor: number;
}

export async function loadKycWithdrawUsage(db: Queryable, userId: string): Promise<KycWithdrawUsage> {
  const r = await db.query(
    `SELECT COALESCE(SUM(amount_minor), 0) AS used_minor,
            COALESCE(SUM(amount_minor) FILTER (WHERE debit_state = 'debited'), 0) AS used_debited_minor
       FROM crypto_withdrawals
      WHERE user_id = $1 AND status IN ('requested', 'approved', 'sent', 'settled', 'needs_review')`,
    [userId],
  );
  const row = r.rows[0] ?? {};
  return {
    usedMinor: Number(row.used_minor ?? 0),
    usedDebitedMinor: Number(row.used_debited_minor ?? 0),
  };
}

export function computeKycAllowance(input: {
  bps: number;
  balanceMinor: number;
  usage: KycWithdrawUsage;
}): KycAllowance {
  const bps = Math.max(0, Math.min(10_000, Math.trunc(input.bps)));
  const balanceMinor = Math.max(0, Math.trunc(input.balanceMinor));
  const baseMinor = balanceMinor + Math.max(0, input.usage.usedDebitedMinor);
  const limitMinor = Number((BigInt(baseMinor) * BigInt(bps)) / 10_000n);
  const usedMinor = Math.max(0, input.usage.usedMinor);
  return {
    bps,
    balanceMinor,
    baseMinor,
    limitMinor,
    usedMinor,
    remainingMinor: Math.max(0, limitMinor - usedMinor),
  };
}

export async function readRealBalanceMinor(
  terminal: Pick<TerminalMoneyClient, 'accounts'>,
  userId: string,
): Promise<number | null> {
  if (!terminal.accounts) return null;
  const out = await terminal.accounts(userId).catch(() => null);
  if (!out || out.state !== 'ok') return null;
  const real = out.accounts.find((a) => a.kind === 'real');
  if (!real || !real.opened) return 0;
  return real.balanceMinor === null ? null : real.balanceMinor;
}

export async function resolveKycAllowance(
  db: Queryable,
  terminal: Pick<TerminalMoneyClient, 'accounts'>,
  userId: string,
  bps: number,
): Promise<KycAllowance | null> {
  const [usage, balanceMinor] = await Promise.all([
    loadKycWithdrawUsage(db, userId),
    readRealBalanceMinor(terminal, userId),
  ]);
  if (balanceMinor === null) return null;
  return computeKycAllowance({ bps, balanceMinor, usage });
}
