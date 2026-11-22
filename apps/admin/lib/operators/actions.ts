'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getOperatorSession } from '../auth/current';
import { LOGIN_PATH } from '../auth/constants';
import type { OperatorRole } from '../auth/session';
import {
  createOperator,
  disableOperator,
  changeOperatorRole,
} from './provision';

export interface OperatorActionState {
  error?: string;
  ok?: boolean;
}

const ROUTE = '/operators';

async function requireAdminActor(): Promise<string> {
  const operator = await getOperatorSession();
  if (!operator) {
    redirect(LOGIN_PATH);
  }
  if (operator.role !== 'admin') {
    throw new ForbiddenError();
  }
  return operator.operatorId;
}

class ForbiddenError extends Error {}

function asRole(value: FormDataEntryValue | null): OperatorRole | null {
  return value === 'admin' || value === 'operator' || value === 'finance_operator' || value === 'support_operator'
    ? value
    : null;
}

export async function createOperatorAction(
  _prev: OperatorActionState,
  formData: FormData,
): Promise<OperatorActionState> {
  let actorId: string;
  try {
    actorId = await requireAdminActor();
  } catch {
    return { error: 'forbidden' };
  }

  const role = asRole(formData.get('role'));
  if (!role) return { error: 'invalidRole' };

  const result = await createOperator({
    actorId,
    login: String(formData.get('login') ?? ''),
    displayName: String(formData.get('displayName') ?? ''),
    role,
    password: String(formData.get('password') ?? ''),
    reason: String(formData.get('reason') ?? ''),
  });

  if (!result.ok) return { error: result.reason };

  revalidatePath(ROUTE);
  return { ok: true };
}

export async function disableOperatorAction(
  _prev: OperatorActionState,
  formData: FormData,
): Promise<OperatorActionState> {
  let actorId: string;
  try {
    actorId = await requireAdminActor();
  } catch {
    return { error: 'forbidden' };
  }

  const operatorId = String(formData.get('operatorId') ?? '').trim();
  if (!operatorId) return { error: 'invalidSubject' };

  const result = await disableOperator({
    actorId,
    operatorId,
    reason: String(formData.get('reason') ?? ''),
  });

  if (!result.ok) return { error: result.reason };

  revalidatePath(ROUTE);
  return { ok: true };
}

export async function changeOperatorRoleAction(
  _prev: OperatorActionState,
  formData: FormData,
): Promise<OperatorActionState> {
  let actorId: string;
  try {
    actorId = await requireAdminActor();
  } catch {
    return { error: 'forbidden' };
  }

  const operatorId = String(formData.get('operatorId') ?? '').trim();
  if (!operatorId) return { error: 'invalidSubject' };

  const newRole = asRole(formData.get('newRole'));
  if (!newRole) return { error: 'invalidRole' };

  const result = await changeOperatorRole({
    actorId,
    operatorId,
    newRole,
    reason: String(formData.get('reason') ?? ''),
  });

  if (!result.ok) return { error: result.reason };

  revalidatePath(ROUTE);
  return { ok: true };
}
