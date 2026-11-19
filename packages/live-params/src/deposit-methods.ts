export interface DepositMethod {
  asset: string;
  network: string;
}

export const DEPOSIT_METHODS: readonly DepositMethod[] = Object.freeze([{ asset: 'USDT', network: 'TRC20' }]);

export function depositMethodLabel(method: DepositMethod): string {
  return `${method.asset} (${method.network})`;
}
