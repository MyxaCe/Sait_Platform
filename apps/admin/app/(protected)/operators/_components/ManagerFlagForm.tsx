'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { setManagerFlagAction, type ManagerActionState } from '@/lib/managers/actions';
import { ActionResult, ReasonField, SubmitButton } from '@/components/control/forms';
import { MANAGER_ERRORS } from '../../clients/_components/managers/messages';

/**
 * Выдать / снять флаг «менеджер клиентов» (только admin, основание → журнал
 * `operator.client_manager_granted` / `operator.client_manager_revoked`).
 * Снять флаг с менеджера с закреплёнными клиентами нельзя — сервер вернёт
 * `hasClients`, форма заранее предупреждает.
 */
export function ManagerFlagForm({
  operatorId,
  enabled,
  clients,
}: {
  operatorId: string;
  enabled: boolean;
  clients: number;
}) {
  const [state, action] = useFormState<ManagerActionState, FormData>(setManagerFlagAction, {});
  const [reason, setReason] = useState('');
  const blocked = enabled && clients > 0;

  return (
    <form action={action} className="space-y-3">
      <ActionResult
        state={state}
        okText={enabled ? 'Флаг снят, запись в журнале.' : 'Оператор стал менеджером клиентов, запись в журнале.'}
        messages={MANAGER_ERRORS}
      />
      <input type="hidden" name="operatorId" value={operatorId} />
      <input type="hidden" name="enabled" value={enabled ? 'false' : 'true'} />
      {blocked ? (
        <p className="text-warning text-xs">
          За оператором закреплено клиентов: {clients}. Чтобы снять флаг, сначала передайте их другому
          менеджеру (реестр → фильтр по менеджеру → массовое назначение).
        </p>
      ) : (
        <>
          <ReasonField id="mgr-flag-reason" value={reason} onChange={setReason} />
          <SubmitButton variant={enabled ? 'secondary' : 'primary'} disabled={reason.trim().length === 0}>
            {enabled ? 'Снять флаг «менеджер клиентов»' : 'Сделать менеджером клиентов'}
          </SubmitButton>
        </>
      )}
    </form>
  );
}
