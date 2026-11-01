'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Button, Input, Select } from '@broker/ui';
import type { OperatorRole } from '@/lib/auth/session';
import {
  changeOperatorRoleAction,
  disableOperatorAction,
  type OperatorActionState,
} from '@/lib/operators/actions';
import { operatorErrorText } from './messages';

/**
 * Отзывающие действия над оператором (ADM-04): сменить роль и отключить.
 * Асимметрия Р-394 — это НЕ событие, а отзыв прав: danger-подтверждение в два
 * шага (первый клик «вооружает», второй исполняет), основание обязательно
 * (форма-с-основанием, уходит в журнал). Действия над самим собой сюда не
 * попадают — таблица их не отрисовывает (fail-closed на уровне UI).
 */
export function OperatorRowActions({
  operatorId,
  login,
  role,
}: {
  operatorId: string;
  login: string;
  role: OperatorRole;
}) {
  const [open, setOpen] = useState<'none' | 'role' | 'disable'>('none');
  const otherRole: OperatorRole = role === 'admin' ? 'operator' : 'admin';

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => setOpen(open === 'role' ? 'none' : 'role')}
        >
          Сменить роль
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => setOpen(open === 'disable' ? 'none' : 'disable')}
        >
          Отключить
        </Button>
      </div>

      {open === 'role' && (
        <ChangeRolePanel operatorId={operatorId} login={login} defaultRole={otherRole} />
      )}
      {open === 'disable' && <DisablePanel operatorId={operatorId} login={login} />}
    </div>
  );
}

function PanelFeedback({ state }: { state: OperatorActionState }) {
  if (state.ok) {
    return (
      <p role="status" className="text-xs text-positive">
        Готово.
      </p>
    );
  }
  if (state.error) {
    return (
      <p role="alert" className="text-xs text-negative">
        {operatorErrorText(state.error)}
      </p>
    );
  }
  return null;
}

function ChangeRolePanel({
  operatorId,
  login,
  defaultRole,
}: {
  operatorId: string;
  login: string;
  defaultRole: OperatorRole;
}) {
  const [state, action] = useFormState<OperatorActionState, FormData>(changeOperatorRoleAction, {});
  return (
    <form action={action} className="space-y-2 rounded border border-border bg-base p-3">
      <input type="hidden" name="operatorId" value={operatorId} />
      <p className="text-xs text-secondary">Новая роль для {login}:</p>
      <Select name="newRole" defaultValue={defaultRole} className="max-w-[12rem]">
        <option value="operator">operator</option>
        <option value="admin">admin</option>
      </Select>
      <Input name="reason" required placeholder="Основание (в журнал)" autoComplete="off" />
      <PanelFeedback state={state} />
      <TwoStepSubmit idle="Сменить роль" armedLabel="Подтвердить смену роли" />
    </form>
  );
}

function DisablePanel({ operatorId, login }: { operatorId: string; login: string }) {
  const [state, action] = useFormState<OperatorActionState, FormData>(disableOperatorAction, {});
  return (
    <form action={action} className="space-y-2 rounded border border-negative/40 bg-base p-3">
      <input type="hidden" name="operatorId" value={operatorId} />
      <p className="text-xs text-secondary">
        Отключить {login}: вход будет закрыт. Отзыв доступа — подтвердите в два шага.
      </p>
      <Input name="reason" required placeholder="Основание (в журнал)" autoComplete="off" />
      <PanelFeedback state={state} />
      <TwoStepSubmit idle="Отключить" armedLabel="Подтвердить отключение" />
    </form>
  );
}

/**
 * Danger-подтверждение в два шага (§5.4): первый клик «вооружает» (это обычная
 * кнопка, форму НЕ отправляет), второй — реальный submit. «Отмена» снимает
 * взвод. loading-состояние берётся из `useFormStatus` активной формы.
 */
function TwoStepSubmit({ idle, armedLabel }: { idle: string; armedLabel: string }) {
  const [armed, setArmed] = useState(false);
  const { pending } = useFormStatus();

  if (!armed) {
    return (
      <Button type="button" size="sm" variant="danger" onClick={() => setArmed(true)}>
        {idle}
      </Button>
    );
  }

  return (
    <div className="flex gap-2">
      <Button type="submit" size="sm" variant="danger" loading={pending} disabled={pending}>
        {armedLabel}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setArmed(false)} disabled={pending}>
        Отмена
      </Button>
    </div>
  );
}
