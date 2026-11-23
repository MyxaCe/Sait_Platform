'use client';

import { setClientWithdrawManualOnlyAction } from '@/lib/crypto/actions';
import { ActionForm } from '../../../_money/ActionForm';

export function ManualOnlyPanel({ userId, manualOnly }: { userId: string; manualOnly: boolean }) {
  return (
    <ActionForm
      action={setClientWithdrawManualOnlyAction}
      submitLabel="Сохранить"
      okText="Флаг сохранён, запись в журнале."
      reasonPlaceholder="Напр.: новый аккаунт, крупный вывод сразу после пополнения"
    >
      <input type="hidden" name="userId" value={userId} />
      <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-sunken px-3 py-2.5 hover:border-border-strong">
        <input
          type="checkbox"
          name="manualOnly"
          defaultChecked={manualOnly}
          className="mt-0.5 size-4 shrink-0 accent-[rgb(var(--warning))]"
        />
        <span>
          <span className="block text-sm font-medium text-primary">Только ручной вывод</span>
          <span className="block text-xs text-muted">
            Выводы клиента всегда исполняются вручную, даже когда для платформы включено «Авто». Сейчас
            автоотправка не подключена, поэтому поведение не меняется — флаг виден в очереди выводов.
            Клиент флаг не видит.
          </span>
        </span>
      </label>
    </ActionForm>
  );
}
