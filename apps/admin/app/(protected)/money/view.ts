import type { DepositRowView, WithdrawalRowView } from '@/lib/crypto/queries';

export type MoneyTab = 'withdrawals' | 'deposits' | 'unidentified' | 'credits';

export const WITHDRAWAL_SLA_HOURS = 24;
export const DEPOSIT_STUCK_MINUTES = 60;

const OPEN_ORDER: Record<string, number> = { needs_review: 0, requested: 1, approved: 2, sent: 3 };

export const isOpenWithdrawal = (status: string) => status in OPEN_ORDER;
export const awaitsOperator = (status: string) => status === 'requested' || status === 'needs_review';

export type WithdrawalFilter = 'open' | 'closed' | 'all';

export function asWithdrawalFilter(v: string | undefined): WithdrawalFilter {
  return v === 'closed' || v === 'all' ? v : 'open';
}

export function orderWithdrawals(rows: WithdrawalRowView[], f: WithdrawalFilter): WithdrawalRowView[] {
  const open = rows
    .filter((w) => isOpenWithdrawal(w.status))
    .sort(
      (a, b) =>
        OPEN_ORDER[a.status]! - OPEN_ORDER[b.status]! || a.requestedAt.localeCompare(b.requestedAt),
    );
  const closed = rows
    .filter((w) => !isOpenWithdrawal(w.status))
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  return f === 'open' ? open : f === 'closed' ? closed : [...open, ...closed];
}

export function hoursSince(iso: string, now = Date.now()): number {
  return (now - new Date(iso).getTime()) / 3_600_000;
}

export type DepositFilter = 'all' | 'claimed' | 'credited' | 'rejected';

export function asDepositFilter(v: string | undefined): DepositFilter {
  return v === 'claimed' || v === 'credited' || v === 'rejected' ? v : 'all';
}

export function filterDeposits(rows: DepositRowView[], f: DepositFilter): DepositRowView[] {
  return f === 'all' ? rows : rows.filter((d) => d.status === f);
}

export function moneyHref(params: {
  tab?: MoneyTab;
  f?: string;
  ds?: string;
  w?: string;
  u?: string;
  anchor?: string;
}): string {
  const q = new URLSearchParams();
  if (params.tab && params.tab !== 'withdrawals') q.set('tab', params.tab);
  if (params.f && params.f !== 'open') q.set('f', params.f);
  if (params.ds && params.ds !== 'all') q.set('ds', params.ds);
  if (params.w) q.set('w', params.w);
  if (params.u) q.set('u', params.u);
  const s = q.toString();
  return `/money${s ? `?${s}` : ''}${params.anchor ? `#${params.anchor}` : ''}`;
}

export function sumMinor(rows: Array<{ amountMinor: number | null }>): number {
  return rows.reduce((s, r) => s + (r.amountMinor ?? 0), 0);
}

export interface AwaitingSend {
  count: number;
  totalMinor: number;
  oldest: WithdrawalRowView | null;
}

export function awaitingSend(rows: WithdrawalRowView[]): AwaitingSend {
  const list = rows
    .filter((w) => w.status === 'approved' && !w.payoutTxHash)
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  return { count: list.length, totalMinor: sumMinor(list), oldest: list[0] ?? null };
}

export function requestsWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'заявка';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'заявки';
  return 'заявок';
}
