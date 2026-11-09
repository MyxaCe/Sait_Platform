'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { Select } from '@broker/ui';
import type { OperatorRole } from '@/lib/auth/session';
import {
  changeOperatorRoleAction,
  disableOperatorAction,
  type OperatorActionState,
} from '@/lib/operators/actions';
import { ActionResult, ArmedSubmit, Field, ReasonField } from '@/components/control/forms';
import { OPERATOR_ERRORS } from './messages';
import { ROLES, ROLE_LABEL, ROLE_SCOPE } from './roles';

/**
 * Отзывающие действия над оператором (ADM-04): сменить роль и отключить.
 * Асимметрия Р-394 — это НЕ событие, а изменение прав: подтверждение в два
 * шага (§6.7), основание обязательно (уходит в журнал). Действия над самим
 * собой сюда не попадают — таблица не даёт выбрать себя (fail-closed в UI), и
 * server action проверяет это ещё раз.
 */

export function ChangeRoleForm({
  operatorId,
  login,
  role,
}: {
  operatorId: string;
  login: string;
  role: OperatorRole;
}) {
  const [state, action] = useFormState<OperatorActionState, FormData>(changeOperatorRoleAction, {});
  const options = ROLES.filter((r) => r !== role);
  const [newRole, setNewRole] = useState<OperatorRole>(options[0] ?? 'operator');
  const [reason, setReason] = useState('');

  return (
    <form action={action} className="space-y-3">
      <ActionResult
        state={state}
        okText="Роль изменена, запись в журнале."
        messages={OPERATOR_ERRORS}
      />
      <input type="hidden" name="operatorId" value={operatorId} />
      <Field label="Новая роль" htmlFor="newRole" hint={ROLE_SCOPE[newRole]}>
        <Select
          id="newRole"
          name="newRole"
          controlSize="compact"
          value={newRole}
          onChange={(e) => setNewRole(e.target.value as OperatorRole)}
        >
          {options.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </Select>
      </Field>
      <ReasonField id="role-reason" value={reason} onChange={setReason} />
      <ArmedSubmit
        idle="Сменить роль"
        confirm="Да, сменить роль"
        consequence={`${login}: «${ROLE_LABEL[role]}» → «${ROLE_LABEL[newRole]}». Набор разделов и действий оператора изменится.`}
        disabled={reason.trim().length === 0}
        resetKey={`${newRole}|${reason}`}
      />
    </form>
  );
}

export function DisableOperatorForm({ operatorId, login }: { operatorId: string; login: string }) {
  const [state, action] = useFormState<OperatorActionState, FormData>(disableOperatorAction, {});
  const [reason, setReason] = useState('');

  return (
    <form action={action} className="space-y-3">
      <ActionResult
        state={state}
        okText="Оператор отключён, запись в журнале."
        messages={OPERATOR_ERRORS}
      />
      <input type="hidden" name="operatorId" value={operatorId} />
      <ReasonField
        id="disable-reason"
        value={reason}
        onChange={setReason}
        label="Основание отключения"
      />
      <ArmedSubmit
        idle="Отключить оператора"
        confirm="Да, отключить"
        consequence={`Вход для ${login} будет закрыт. Учётная запись не удаляется — на неё ссылаются записи журнала.`}
        disabled={reason.trim().length === 0}
        resetKey={reason}
      />
    </form>
  );
}
