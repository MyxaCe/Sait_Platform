/**
 * ФАКТЫ, над которыми считает движок. Только то, что уже есть в базе сайта:
 * зачисленные депозиты (`crypto_deposits`), KYC (`client_verification`),
 * сделки реального счёта (`real_trades`), заявки на вывод
 * (`crypto_withdrawals`). Читатель (`reader.ts`) собирает их одним проходом;
 * движок (`evaluate.ts`) — чистые функции над ними.
 *
 * Время — ISO-строки (как из базы); сравнение — через `Date.parse`.
 */

export interface DepositFact {
  id: string;
  amountMinor: number;
  creditedAt: string;
  fromAddress?: string | null;
}

export interface TradeFact {
  symbol: string;
  side: 'buy' | 'sell';
  /** Количество базового актива. */
  volume: number;
  /** Цена исполнения в валюте котировки (USD/USDT). */
  price: number;
  executedAt: string;
  /**
   * Комиссия и наценка сделки (минорные единицы). `null` — событие поле не
   * несло (старый терминал): это «не знаем», а для кешбэка — ноль, не догадка.
   */
  commissionMinor?: number | null;
  markupMinor?: number | null;
  /** Реализованный результат сделки (минорные). `null` — открывающая. */
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

/** Заявка на вывод, которая «двигала деньги» (отклонённая/отменённая — нет). */
export function isLiveWithdrawal(w: WithdrawalFact): boolean {
  return w.status !== 'rejected' && w.status !== 'cancelled';
}
