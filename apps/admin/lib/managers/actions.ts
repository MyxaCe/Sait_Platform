'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getOperatorSession } from '../auth/current';
import { LOGIN_PATH } from '../auth/constants';
import { assignClientManagers, setClientManagerFlag } from './assign';
import { canAssignManagers } from './policy';

/**
 * Server actions «менеджеров клиентов». Тот же выбор, что у блокировки
 * (`lib/clients/actions.ts`): POST в защищённый роут, `/api` не расширяем.
 *
 * Роль-гейт — только admin, fail-closed: остальные получают `forbidden`, до
 * транзакции дело не доходит (в UI форм у них и так нет). Автор — из сессии.
 */

export interface ManagerActionState {
  error?: string;
  ok?: boolean;
  /** Сколько клиентов фактически сменили менеджера / уже были за ним. */
  changed?: number;
  unchanged?: number;
}

async function requireAssigner() {
  const operator = await getOperatorSession();
  if (!operator) redirect(LOGIN_PATH);
  return canAssignManagers(operator.role) ? operator : null;
}

async function runAssign(userIds: string[], formData: FormData): Promise<ManagerActionState> {
  const operator = await requireAssigner();
  if (!operator) return { error: 'forbidden' };

  const rawManager = String(formData.get('managerId') ?? '').trim();
  if (!rawManager) return { error: 'missingManager' };
  const managerId = rawManager === 'none' ? null : rawManager;

  let result;
  try {
    result = await assignClientManagers({
      actorId: operator.operatorId,
      userIds,
      managerId,
      reason: String(formData.get('reason') ?? ''),
    });
  } catch {
    return { error: 'journalUnavailable' };
  }
  if (!result.ok) return { error: result.reason };

  for (const id of userIds) revalidatePath(`/clients/${id}`);
  revalidatePath('/clients');
  revalidatePath('/');
  return { ok: true, changed: result.changed, unchanged: result.unchanged };
}

/** Карточка клиента: назначить / сменить / снять менеджера одного клиента. */
export async function assignClientManagerAction(
  _prev: ManagerActionState,
  formData: FormData,
): Promise<ManagerActionState> {
  const userId = String(formData.get('userId') ?? '').trim();
  if (!userId) return { error: 'noClients' };
  return runAssign([userId], formData);
}

/** Реестр: массовое назначение отмеченным клиентам (`userIds` — чекбоксы строк). */
export async function bulkAssignManagerAction(
  _prev: ManagerActionState,
  formData: FormData,
): Promise<ManagerActionState> {
  const userIds = formData.getAll('userIds').map((v) => String(v));
  return runAssign(userIds, formData);
}

/** Экран «Операторы»: выдать / снять флаг «менеджер клиентов». */
export async function setManagerFlagAction(
  _prev: ManagerActionState,
  formData: FormData,
): Promise<ManagerActionState> {
  const operator = await requireAssigner();
  if (!operator) return { error: 'forbidden' };

  const operatorId = String(formData.get('operatorId') ?? '').trim();
  const enabled = String(formData.get('enabled') ?? '') === 'true';
  let result;
  try {
    result = await setClientManagerFlag({
      actorId: operator.operatorId,
      operatorId,
      enabled,
      reason: String(formData.get('reason') ?? ''),
    });
  } catch {
    return { error: 'journalUnavailable' };
  }
  if (!result.ok) return { error: result.reason };

  revalidatePath('/operators');
  revalidatePath('/clients');
  return { ok: true };
}
