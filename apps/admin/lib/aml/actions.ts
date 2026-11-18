'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getOperatorSession } from '../auth/current';
import { canAccessSection } from '@/components/shell/sections';
import { LOGIN_PATH } from '../auth/constants';
import { clearAmlEscalation, recordAmlScreening } from './screening';
import { normalizeSanctionsLists, type AmlOutcome } from './lists';

export interface ScreeningState {
  error?: string;
  ok?: boolean;
}

function asOutcome(value: unknown): AmlOutcome | null {
  return value === 'clear' || value === 'escalated' ? value : null;
}

export async function recordScreeningAction(
  _prev: ScreeningState,
  formData: FormData,
): Promise<ScreeningState> {
  const operator = await getOperatorSession();
  if (!operator) {
    redirect(LOGIN_PATH);
  }
  if (!canAccessSection(operator.role, 'aml')) return { error: 'forbidden' };

  const userId = String(formData.get('userId') ?? '').trim();
  if (!userId) return { error: 'invalidClient' };

  const outcome = asOutcome(formData.get('outcome'));
  if (!outcome) return { error: 'invalidOutcome' };

  const lists = normalizeSanctionsLists(formData.getAll('lists'));
  const reason = String(formData.get('reason') ?? '');

  const result = await recordAmlScreening({
    operatorId: operator.operatorId,
    userId,
    outcome,
    listsChecked: lists,
    reason,
  });

  if (!result.ok) {
    return { error: result.reason };
  }

  revalidatePath(`/aml/${userId}`);
  revalidatePath('/aml');
  revalidatePath(`/clients/${userId}`);
  return { ok: true };
}

export async function clearEscalationAction(
  _prev: ScreeningState,
  formData: FormData,
): Promise<ScreeningState> {
  const operator = await getOperatorSession();
  if (!operator) {
    redirect(LOGIN_PATH);
  }
  if (operator.role !== 'admin' || !canAccessSection(operator.role, 'aml')) {
    return { error: 'forbidden' };
  }

  const userId = String(formData.get('userId') ?? '').trim();
  if (!userId) return { error: 'invalidClient' };
  const reason = String(formData.get('reason') ?? '');

  const result = await clearAmlEscalation({
    operatorId: operator.operatorId,
    userId,
    reason,
  });

  if (!result.ok) {
    return { error: result.reason };
  }

  revalidatePath(`/aml/${userId}`);
  revalidatePath('/aml');
  revalidatePath(`/clients/${userId}`);
  return { ok: true };
}
