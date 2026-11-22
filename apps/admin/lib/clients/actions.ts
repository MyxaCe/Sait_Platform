'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getOperatorSession } from '../auth/current';
import { LOGIN_PATH } from '../auth/constants';
import { revokeClientSessions, setClientBlock, type BlockAction } from './block';

export interface ClientActionState {
  error?: string;
  ok?: boolean;
}

async function requireAdmin() {
  const operator = await getOperatorSession();
  if (!operator) {
    redirect(LOGIN_PATH);
  }
  if (operator.role !== 'admin') {
    return null;
  }
  return operator;
}

async function changeBlock(
  action: BlockAction,
  formData: FormData,
): Promise<ClientActionState> {
  const operator = await requireAdmin();
  if (!operator) return { error: 'forbidden' };

  const userId = String(formData.get('userId') ?? '').trim();
  if (!userId) return { error: 'invalidClient' };
  const reason = String(formData.get('reason') ?? '');

  const result = await setClientBlock({
    operatorId: operator.operatorId,
    userId,
    action,
    reason,
  });

  if (!result.ok) return { error: result.reason };

  revalidatePath(`/clients/${userId}`);
  revalidatePath('/clients');
  return { ok: true };
}

export async function blockClientAction(
  _prev: ClientActionState,
  formData: FormData,
): Promise<ClientActionState> {
  return changeBlock('block', formData);
}

export async function unblockClientAction(
  _prev: ClientActionState,
  formData: FormData,
): Promise<ClientActionState> {
  return changeBlock('unblock', formData);
}

export async function revokeClientSessionsAction(
  _prev: ClientActionState,
  formData: FormData,
): Promise<ClientActionState> {
  const operator = await requireAdmin();
  if (!operator) return { error: 'forbidden' };

  const userId = String(formData.get('userId') ?? '').trim();
  if (!userId) return { error: 'invalidClient' };
  const reason = String(formData.get('reason') ?? '');

  let result;
  try {
    result = await revokeClientSessions({ operatorId: operator.operatorId, userId, reason });
  } catch {
    return { error: 'journalUnavailable' };
  }
  if (!result.ok) return { error: result.reason };

  revalidatePath(`/clients/${userId}`);
  return { ok: true };
}
