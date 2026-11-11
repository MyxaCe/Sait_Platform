'use client';

import { Checkbox, Input, Textarea } from '@broker/ui';
import { updateCredentialSettingsAction } from '@/lib/credentials/actions';
import { credentialErrorText } from '@/lib/credentials/policy';
import { ActionForm } from '../_money/ActionForm';

/**
 * «Безопасность учётных данных» (функция 3): чек-лист проверки личности,
 * автозаморозка вывода после правки, порог алерта и срок временного пароля.
 * Только admin; изменение — с основанием, журнал до/после.
 */
function Num({ name, label, defaultValue, suffix }: { name: string; label: string; defaultValue: number; suffix: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-muted block text-xs">{label}</span>
      <span className="relative block w-36">
        <Input name={name} defaultValue={String(defaultValue)} controlSize="compact" inputMode="numeric" autoComplete="off" className="pr-12 text-right tabular-nums" />
        <span className="text-muted pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs">{suffix}</span>
      </span>
    </label>
  );
}

export function CredentialSettingsForm({
  initial,
}: {
  initial: { checklistText: string; minChecked: number; autoHoldEnabled: boolean; autoHoldHours: number; alertPerOperatorDay: number; tempPasswordHours: number };
}) {
  return (
    <ActionForm
      action={updateCredentialSettingsAction}
      submitLabel="Сохранить настройки безопасности"
      okText="Сохранено, запись в журнале."
      errorText={credentialErrorText}
      reasonPlaceholder="Почему меняются правила правки учётных данных"
    >
      <label className="block space-y-1.5">
        <span className="text-muted block text-xs">Чек-лист проверки личности — пункт на строку, «*» в начале — обязательный</span>
        <Textarea name="checklist" rows={5} defaultValue={initial.checklistText} className="font-[inherit] text-[13px]" />
      </label>
      <label className="border-border bg-sunken hover:border-border-strong flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5">
        <Checkbox name="autoHoldEnabled" defaultChecked={initial.autoHoldEnabled} className="mt-0.5 size-4" />
        <span className="min-w-0">
          <span className="text-primary block text-sm font-medium">Автозаморозка вывода после правки</span>
          <span className="text-muted block text-xs">Включено: после смены email или временного пароля вывод закрыт на N часов (менеджер может снять вручную).</span>
          <span className="text-muted block text-xs">Выключено: вывод замораживают только вручную.</span>
        </span>
      </label>
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <Num name="autoHoldHours" label="Автозаморозка" defaultValue={initial.autoHoldHours} suffix="ч" />
        <Num name="minChecked" label="Минимум отметок" defaultValue={initial.minChecked} suffix="шт" />
        <Num name="alertPerOperatorDay" label="Алерт: правок оператора за сутки больше" defaultValue={initial.alertPerOperatorDay} suffix="шт" />
        <Num name="tempPasswordHours" label="Срок временного пароля" defaultValue={initial.tempPasswordHours} suffix="ч" />
      </div>
    </ActionForm>
  );
}
