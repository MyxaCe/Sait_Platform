export const REAL_ACCOUNT_CURRENCY = 'USDT' as const;

export function realMoneyCurrency(_stored?: string | null): typeof REAL_ACCOUNT_CURRENCY {
  return REAL_ACCOUNT_CURRENCY;
}
