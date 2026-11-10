'use client';

import { useEffect, useState } from 'react';
import { useFormState } from 'react-dom';
import { Select } from '@broker/ui';
import { bulkAssignManagerAction, type ManagerActionState } from '@/lib/managers/actions';
import { ActionResult, Field, ReasonField, SubmitButton } from '@/components/control/forms';
import { MANAGER_ERRORS } from './messages';
import type { ManagerChoice } from './AssignManagerForm';

export const BULK_FORM_ID = 'bulk-assign-managers';

function checkedBoxes(): HTMLInputElement[] {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][form="${BULK_FORM_ID}"][name="userIds"]`),
  ).filter((i) => i.checked);
}

/**
 * Чекбокс строки реестра. Принадлежит форме массового назначения через атрибут
 * `form` — таблица остаётся серверной, форма живёт отдельно над ней.
 */
export function RowCheckbox({ userId, label }: { userId: string; label: string }) {
  return (
    <input
      type="checkbox"
      name="userIds"
      value={userId}
      form={BULK_FORM_ID}
      aria-label={`Выбрать: ${label}`}
      className="accent-accent size-4 cursor-pointer align-middle"
      onChange={() => document.dispatchEvent(new Event('bulk-assign-change'))}
    />
  );
}

/** «Выбрать всех на странице» — в заголовке колонки. */
export function SelectAllOnPage() {
  return (
    <input
      type="checkbox"
      aria-label="Выбрать всех на странице"
      className="accent-accent size-4 cursor-pointer align-middle"
      onChange={(e) => {
        const on = e.currentTarget.checked;
        document
          .querySelectorAll<HTMLInputElement>(`input[type="checkbox"][form="${BULK_FORM_ID}"][name="userIds"]`)
          .forEach((i) => {
            i.checked = on;
          });
        document.dispatchEvent(new Event('bulk-assign-change'));
      }}
    />
  );
}

/**
 * Массовое назначение менеджера из реестра (только admin). Отмеченные строки +
 * менеджер + основание → одна транзакция, по записи журнала на клиента
 * (`bulk: true`). Без отметок, менеджера или основания — «Назначить» неактивна.
 */
export function BulkAssignBar({ managers }: { managers: ManagerChoice[] }) {
  const [state, action] = useFormState<ManagerActionState, FormData>(bulkAssignManagerAction, {});
  const [count, setCount] = useState(0);
  const [managerId, setManagerId] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    const update = () => setCount(checkedBoxes().length);
    update();
    document.addEventListener('bulk-assign-change', update);
    return () => document.removeEventListener('bulk-assign-change', update);
  }, []);

  const okText =
    state.ok && state.changed !== undefined
      ? `Готово: менеджер сменён у ${state.changed}${state.unchanged ? `, уже был у ${state.unchanged}` : ''}. Записи в журнале.`
      : 'Готово.';

  return (
    <form id={BULK_FORM_ID} action={action} className="border-border mb-2.5 space-y-3 border-b pb-3">
      <ActionResult state={state} okText={okText} messages={MANAGER_ERRORS} />
      <div className="flex flex-wrap items-end gap-3">
        <p className="text-primary min-w-[9rem] pb-2 text-[13px] font-medium tabular-nums">
          Выбрано: {count}
        </p>
        <Field label="Назначить менеджера" htmlFor="bulk-manager" className="w-64">
          <Select
            id="bulk-manager"
            name="managerId"
            controlSize="compact"
            value={managerId}
            onChange={(e) => setManagerId(e.target.value)}
          >
            <option value="">— выберите —</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName} ({m.clients})
              </option>
            ))}
            <option value="none">Снять менеджера</option>
          </Select>
        </Field>
        <div className="min-w-[16rem] flex-1">
          <ReasonField
            id="bulk-reason"
            value={reason}
            onChange={setReason}
            placeholder="Основание массового назначения (обязательно)"
          />
        </div>
        <div className="pb-6">
          <SubmitButton disabled={count === 0 || !managerId || reason.trim().length === 0}>
            {managerId === 'none' ? `Снять у ${count}` : `Назначить ${count}`}
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}
