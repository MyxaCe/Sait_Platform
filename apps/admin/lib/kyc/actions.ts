'use server';

import { redirect } from 'next/navigation';
import { getOperatorSession } from '../auth/current';
import { canAccessSection } from '@/components/shell/sections';
import { LOGIN_PATH } from '../auth/constants';
import { decideClientVerification, type VerificationDecision } from './decide';

export interface DecisionState {
  error?: string;
}

async function decide(
  decision: VerificationDecision,
  formData: FormData,
): Promise<DecisionState> {
  const operator = await getOperatorSession();
  if (!operator) {
    redirect(LOGIN_PATH);
  }
  if (!canAccessSection(operator.role, 'kyc')) return { error: 'forbidden' };

  const userId = String(formData.get('userId') ?? '').trim();
  if (!userId) {
    return { error: 'invalidClient' };
  }
  const reason = String(formData.get('reason') ?? '');

  const result = await decideClientVerification({
    operatorId: operator.operatorId,
    userId,
    decision,
    reason,
  });

  if (!result.ok) {
    return { error: result.reason };
  }

  redirect('/kyc');
}

export async function verifyClientAction(
  _prev: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  return decide('verified', formData);
}

export async function rejectClientAction(
  _prev: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  return decide('rejected', formData);
}

export async function requestResubmitAction(
  _prev: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  return decide('resubmit_requested', formData);
}
