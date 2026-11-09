import { USDT_TRC20_CONTRACT, type DepositRejectReason } from '@broker/money';
import type { SolidTx } from './trongrid';

/**
 * Сверка необратимой транзакции с ожиданием. Чистые функции — проверяются
 * на фикстурах TronGrid.
 *
 * Учитываются только переводы ОФИЦИАЛЬНОГО контракта USDT: токен-подделка с
 * тем же именем «USDT» (спам-контракты на TRON массовые) — `wrong_token`.
 */

export type DepositVerdict =
  | { kind: 'ok'; amountRaw: bigint; fromAddress: string; toAddress: string; blockTime: Date | null }
  | { kind: 'rejected'; reason: Exclude<DepositRejectReason, 'not_found' | 'below_minimum'>; toAddress?: string; amountRaw?: bigint; fromAddress?: string };

export function verifyDeposit(tx: SolidTx, exchangeAddress: string): DepositVerdict {
  if (!tx.success) return { kind: 'rejected', reason: 'failed' };
  const usdt = tx.transfers.filter((t) => t.contract === USDT_TRC20_CONTRACT);
  if (usdt.length === 0) return { kind: 'rejected', reason: 'wrong_token' };
  const toUs = usdt.filter((t) => t.to === exchangeAddress);
  if (toUs.length === 0) {
    return {
      kind: 'rejected',
      reason: 'wrong_recipient',
      toAddress: usdt[0]!.to,
      fromAddress: usdt[0]!.from,
      amountRaw: usdt[0]!.amountRaw,
    };
  }
  return {
    kind: 'ok',
    amountRaw: toUs.reduce((s, t) => s + t.amountRaw, 0n),
    fromAddress: toUs[0]!.from,
    toAddress: exchangeAddress,
    blockTime: tx.blockTime,
  };
}

export type PayoutVerdict = { kind: 'ok'; fromAddress: string | null } | { kind: 'mismatch'; reason: string };

/** Выплата сходится, если успешна, это USDT, получатель и сумма совпадают ТОЧНО. */
export function verifyPayout(tx: SolidTx, expected: { toAddress: string; amountRaw: bigint }): PayoutVerdict {
  if (!tx.success) return { kind: 'mismatch', reason: 'транзакция неуспешна' };
  const usdt = tx.transfers.filter((t) => t.contract === USDT_TRC20_CONTRACT);
  if (usdt.length === 0) return { kind: 'mismatch', reason: 'в транзакции нет перевода USDT TRC20' };
  const toThem = usdt.filter((t) => t.to === expected.toAddress);
  if (toThem.length === 0) {
    return { kind: 'mismatch', reason: `получатель ${usdt[0]!.to}, а в заявке ${expected.toAddress}` };
  }
  const sum = toThem.reduce((s, t) => s + t.amountRaw, 0n);
  if (sum !== expected.amountRaw) {
    return { kind: 'mismatch', reason: `сумма ${sum} (сырые единицы), а в заявке ${expected.amountRaw}` };
  }
  return { kind: 'ok', fromAddress: toThem[0]!.from };
}
