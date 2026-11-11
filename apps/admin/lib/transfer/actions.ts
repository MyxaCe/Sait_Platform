'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  applyPendingRestores,
  closeSourceAccount,
  completeRefundTask,
  createTransfer,
  deliverDue,
  markTransfersSeen,
  parseCountryList,
  retryDelivery,
  revokeTransfer,
  upsertGroupPlatform,
} from '@broker/transfer';
import { getOperatorSession } from '../auth/current';
import { LOGIN_PATH } from '../auth/constants';
import type { MoneyActionState } from '../crypto/actions';
import { canReviewTransfers, selfSlug, signingKey, transferPool, transferTerminal } from './runtime';

/**
 * Server actions перевода на другую платформу группы. Автор — из сессии
 * (Р-451), роль/право — проверяется И здесь, И в ядре пакета (закреплённый
 * менеджер — в SQL транзакции перевода; admin для возврата — там же).
 */

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

async function session() {
  const operator = await getOperatorSession();
  if (!operator) redirect(LOGIN_PATH);
  return operator;
}

/** Сразу после факта — попытка доставки (не ждать такта воркера). Сбой — не ошибка действия. */
async function deliverNow(): Promise<void> {
  const slug = selfSlug();
  if (!slug) return;
  await deliverDue(transferPool(), { selfSlug: slug, signingKey: signingKey(), fetch: fetch as never, limit: 5 }).catch(
    (e: Error) => console.error('[transfer] немедленная доставка не удалась — повторит воркер', e.message),
  );
}

export async function createTransferAction(_prev: MoneyActionState, fd: FormData): Promise<MoneyActionState> {
  const operator = await session();
  const slug = selfSlug();
  if (!slug) return { error: 'noSelf' };
  const userId = str(fd, 'userId');
  if (!str(fd, 'target')) return { error: 'missingTarget' };
  if (!str(fd, 'ticketId')) return { error: 'missingTicket' };
  const r = await createTransfer(transferPool(), {
    operatorId: operator.operatorId,
    userId,
    targetSlug: str(fd, 'target'),
    ticketId: str(fd, 'ticketId'),
    consentMessageId: str(fd, 'consentMessageId'),
    consentConfirmed: fd.get('consentConfirmed') === 'on',
    basis: str(fd, 'reason'),
    selfSlug: slug,
  });
  if (!r.ok) {
    return r.reason === 'directionForbidden' ? { error: r.reason, detail: r.blockers.join(',') } : { error: r.reason };
  }
  await deliverNow();
  revalidatePath(`/clients/${userId}`);
  revalidatePath('/clients/transfers');
  redirect(`/clients/transfers/${r.transferId}?created=1`);
}

export async function revokeTransferAction(_prev: MoneyActionState, fd: FormData): Promise<MoneyActionState> {
  const operator = await session();
  if (!canReviewTransfers(operator.role)) return { error: 'notAdmin' };
  const transferId = str(fd, 'transferId');
  const r = await revokeTransfer(transferPool(), { operatorId: operator.operatorId, transferId, basis: str(fd, 'reason') });
  if (!r.ok) return { error: r.reason };
  if (r.restorePending) {
    // Разморозка торговли в терминале — сразу; не вышло — повторит воркер.
    await applyPendingRestores(transferPool(), transferTerminal()).catch(() => 0);
  }
  await deliverNow();
  revalidatePath(`/clients/transfers/${transferId}`);
  revalidatePath('/clients/transfers');
  return { ok: true, detail: r.stage === 'after_registration' ? 'после регистрации в цели' : 'до регистрации в цели' };
}

export async function closeSourceAction(_prev: MoneyActionState, fd: FormData): Promise<MoneyActionState> {
  const operator = await session();
  const transferId = str(fd, 'transferId');
  const r = await closeSourceAccount(transferPool(), transferTerminal(), {
    operatorId: operator.operatorId,
    role: operator.role,
    transferId,
    basis: str(fd, 'reason'),
  });
  if (!r.ok) return { error: r.reason };
  revalidatePath(`/clients/transfers/${transferId}`);
  return { ok: true };
}

export async function retryDeliveryAction(_prev: MoneyActionState, fd: FormData): Promise<MoneyActionState> {
  const operator = await session();
  if (!str(fd, 'reason')) return { error: 'missingReason' };
  const transferId = str(fd, 'transferId');
  await retryDelivery(transferPool(), { operatorId: operator.operatorId, transferId });
  await deliverNow();
  revalidatePath(`/clients/transfers/${transferId}`);
  return { ok: true };
}

export async function completeRefundTaskAction(_prev: MoneyActionState, fd: FormData): Promise<MoneyActionState> {
  const operator = await session();
  if (operator.role !== 'admin' && operator.role !== 'finance_operator') return { error: 'forbidden' };
  const r = await completeRefundTask(transferPool(), {
    operatorId: operator.operatorId,
    transferId: str(fd, 'transferId'),
    note: str(fd, 'reason'),
  });
  if (!r.ok) return { error: r.reason ?? 'notOpen' };
  revalidatePath('/clients/transfers');
  return { ok: true };
}

export async function markTransfersSeenAction(_prev: MoneyActionState, _fd: FormData): Promise<MoneyActionState> {
  const operator = await session();
  if (!canReviewTransfers(operator.role)) return { error: 'forbidden' };
  const n = await markTransfersSeen(transferPool(), operator.operatorId);
  revalidatePath('/');
  revalidatePath('/clients/transfers');
  return { ok: true, detail: `отмечено: ${n}` };
}

export async function upsertPlatformAction(_prev: MoneyActionState, fd: FormData): Promise<MoneyActionState> {
  const operator = await session();
  if (operator.role !== 'admin') return { error: 'forbidden' };
  const served = parseCountryList(str(fd, 'servedCountries'));
  const forbidden = parseCountryList(str(fd, 'forbiddenCountries'));
  if (!served.ok || !forbidden.ok) return { error: 'invalid', detail: 'invalidCountries' };
  const lev = str(fd, 'maxRetailLeverage');
  const r = await upsertGroupPlatform(transferPool(), {
    operatorId: operator.operatorId,
    basis: str(fd, 'reason'),
    platform: {
      slug: str(fd, 'slug').toLowerCase(),
      name: str(fd, 'name'),
      legalEntity: str(fd, 'legalEntity') || null,
      regulator: str(fd, 'regulator') || null,
      cabinetUrl: str(fd, 'cabinetUrl'),
      apiUrl: str(fd, 'apiUrl') || null,
      publicKeyPem: String(fd.get('publicKeyPem') ?? '').trim() || null,
      euLicense: fd.get('euLicense') === 'on',
      servedCountries: served.value,
      forbiddenCountries: forbidden.value,
      maxRetailLeverage: lev ? Number(lev) : null,
      bonusesAllowed: fd.get('bonusesAllowed') === 'on',
      acceptsTransfers: fd.get('acceptsTransfers') === 'on',
    },
  });
  if (!r.ok) return r.reason === 'invalid' ? { error: 'invalid', detail: r.errors.join(',') } : { error: r.reason };
  revalidatePath('/settings');
  return { ok: true, detail: r.created ? 'платформа добавлена' : 'запись обновлена' };
}
