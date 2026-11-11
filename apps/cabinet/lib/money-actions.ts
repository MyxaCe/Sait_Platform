'use server';

import { revalidatePath } from 'next/cache';
import { claimDeposit, parseUsdtAmountToCents, requestWithdrawal } from '@broker/money';
import { getSessionUser } from './auth/session';
import { isRateLimited } from './rate-limit';
import { moneyPool, terminalMoney } from './money';

/**
 * Экшены ввода/вывода USDT. userId — только из сессии. Политика (блок,
 * заморозка, запрет вывода, KYC) проверяется в той же транзакции, что и
 * запись заявки (`@broker/money`), — кнопка в интерфейсе лишь подсказка.
 */

export interface MoneyFormState {
  ok?: boolean;
  /** Ключ перевода `money.errors.*`. */
  error?: string;
  /** Машинные причины политики (`money.policy.*`). */
  reasons?: string[];
  /** Заявка принята, но списание ещё подтверждается. */
  pending?: boolean;
  /** Отказ по лимиту вывода без верификации: остаток и потолок (центы). */
  kycLimit?: { remainingMinor: number; limitMinor: number };
}

export async function claimDepositAction(_prev: MoneyFormState, fd: FormData): Promise<MoneyFormState> {
  const user = await getSessionUser();
  if (!user) return { error: 'unauthorized' };
  if (isRateLimited(`deposit-claim:${user.id}`, 10, 60_000)) return { error: 'rateLimited' };

  const r = await claimDeposit(moneyPool(), { userId: user.id, txHash: String(fd.get('txHash') ?? '') });
  revalidatePath('/deposit');
  revalidatePath('/wallet'); // r2: ввод и вывод — одна страница «Кошелёк»
  if (r.ok) return { ok: true };
  if (r.reason === 'policy') return { error: 'policy', reasons: r.policyReasons };
  return { error: r.reason };
}

export async function requestWithdrawalAction(_prev: MoneyFormState, fd: FormData): Promise<MoneyFormState> {
  const user = await getSessionUser();
  if (!user) return { error: 'unauthorized' };
  if (isRateLimited(`withdraw:${user.id}`, 5, 60_000)) return { error: 'rateLimited' };

  const amount = parseUsdtAmountToCents(String(fd.get('amount') ?? ''));
  if (!amount.ok) return { error: `amount_${amount.reason}` };

  const r = await requestWithdrawal(moneyPool(), terminalMoney(), {
    userId: user.id,
    toAddress: String(fd.get('address') ?? ''),
    amountMinor: amount.cents,
  });
  revalidatePath('/withdraw');
  revalidatePath('/wallet');
  revalidatePath('/', 'layout');
  if (r.ok) return { ok: true, pending: r.debit === 'pending' };
  if (r.reason === 'policy') return { error: 'policy', reasons: r.policyReasons };
  if (r.reason === 'terminalRefused') return { error: `terminal_${r.code}` };
  if (r.reason === 'kycLimitExceeded') {
    return { error: 'kycLimitExceeded', kycLimit: { remainingMinor: r.remainingMinor, limitMinor: r.limitMinor } };
  }
  return { error: r.reason };
}
