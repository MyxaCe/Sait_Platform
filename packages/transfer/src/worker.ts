import type { PoolLike } from '@broker/money';
import { deliverDue, pruneNonces, type DeliveryDeps } from './channel';
import type { TransferTerminalPort } from './common';
import { applyPendingRestores } from './source';
import { applyPendingFreezes, detectInvitesSent, detectKycPassed, expireInvites } from './target';

/**
 * Один такт воркера канала (обе роли ячейки). Порядок: сначала наблюдения
 * (они ставят статусы в outbox), затем доставка — новые факты уходят в том же
 * такте. Каждый шаг изолирован: сбой одного не останавливает остальные.
 */
export async function runTransferTick(
  pool: PoolLike,
  deps: DeliveryDeps & { terminal?: TransferTerminalPort | null },
): Promise<Record<string, number | string>> {
  const out: Record<string, number | string> = {};
  const step = async (name: string, fn: () => Promise<number | { delivered: number; refused: number; retry: number } | void>) => {
    try {
      const r = await fn();
      if (typeof r === 'number') out[name] = r;
      else if (r) Object.assign(out, r);
    } catch (e) {
      out[`${name}Error`] = (e as Error).message;
      deps.log?.(`[transfer] шаг ${name}: ${(e as Error).message}`);
    }
  };
  await step('invited', () => detectInvitesSent(pool));
  await step('kycPassed', () => detectKycPassed(pool));
  await step('expired', () => expireInvites(pool, deps.now?.() ?? new Date()));
  if (deps.terminal) {
    const terminal = deps.terminal;
    await step('freezes', () => applyPendingFreezes(pool, terminal));
    await step('restores', () => applyPendingRestores(pool, terminal));
  }
  await step('deliver', () => deliverDue(pool, deps));
  await step('prune', () => pruneNonces(pool));
  return out;
}
