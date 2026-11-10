'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { Select } from '@broker/ui';
import { assignClientManagerAction, type ManagerActionState } from '@/lib/managers/actions';
import { ActionResult, Field, ReasonField, SubmitButton } from '@/components/control/forms';
import { MANAGER_ERRORS } from './messages';

export interface ManagerChoice {
  id: string;
  displayName: string;
  clients: number;
}

/**
 * Смена менеджера в карточке клиента (только admin — форма у других ролей не
 * отрисована, action перепроверяет). Форма-с-основанием: без основания и без
 * выбора «Сохранить» неактивна. Запись `client.manager_assigned` /
 * `client.manager_unassigned` — в неизменяемый журнал.
 */
export function AssignManagerForm({
  userId,
  currentManagerId,
  managers,
}: {
  userId: string;
  currentManagerId: string | null;
  managers: ManagerChoice[];
}) {
  const [state, action] = useFormState<ManagerActionState, FormData>(assignClientManagerAction, {});
  const options = managers.filter((m) => m.id !== currentManagerId);
  const [managerId, setManagerId] = useState('');
  const [reason, setReason] = useState('');

  return (
    <form action={action} className="space-y-3">
      <ActionResult state={state} okText="Менеджер сохранён, запись в журнале." messages={MANAGER_ERRORS} />
      <input type="hidden" name="userId" value={userId} />
      <Field
        label={currentManagerId ? 'Новый менеджер' : 'Менеджер'}
        htmlFor="managerId"
        hint={options.length === 0 && !currentManagerId ? 'Нет операторов с флагом «менеджер клиентов» — выдаётся в разделе «Операторы».' : undefined}
      >
        <Select
          id="managerId"
          name="managerId"
          controlSize="compact"
          value={managerId}
          onChange={(e) => setManagerId(e.target.value)}
        >
          <option value="">— выберите —</option>
          {options.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName} · клиентов {m.clients}
            </option>
          ))}
          {currentManagerId ? <option value="none">Снять менеджера</option> : null}
        </Select>
      </Field>
      <ReasonField
        id="manager-reason"
        value={reason}
        onChange={setReason}
        placeholder="Почему клиент закрепляется за этим менеджером (обязательно)"
      />
      <SubmitButton variant={managerId === 'none' ? 'danger-outline' : 'primary'} disabled={!managerId || reason.trim().length === 0}>
        {managerId === 'none' ? 'Снять менеджера' : 'Сохранить'}
      </SubmitButton>
    </form>
  );
}
