import { readWithdrawMode, type WithdrawModeState } from '@broker/money';
import { moneyPool } from './runtime';

export async function getWithdrawMode(): Promise<WithdrawModeState> {
  return readWithdrawMode(moneyPool());
}
