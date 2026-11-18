export interface DepositFact {
  id: string;
  amountMinor: number;
  creditedAt: string;
  fromAddress?: string | null;
}

export interface TradeFact {
  symbol: string;
  side: 'buy' | 'sell';
  volume: number;
  price: number;
  executedAt: string;
  commissionMinor?: number | null;
  markupMinor?: number | null;
  realizedPnlMinor?: number | null;
}

export interface WithdrawalFact {
  id: string;
  requestedAt: string;
  status: string;
}

export interface ClientFacts {
  userId: string;
  registeredAt: string;
  kycVerified: boolean;
  country: string | null;
  deposits: DepositFact[];
  trades: TradeFact[];
  withdrawals: WithdrawalFact[];
}

export const ms = (iso: string): number => Date.parse(iso);

export const DAY_MS = 86_400_000;

export function isLiveWithdrawal(w: WithdrawalFact): boolean {
  return w.status !== 'rejected' && w.status !== 'cancelled';
}
