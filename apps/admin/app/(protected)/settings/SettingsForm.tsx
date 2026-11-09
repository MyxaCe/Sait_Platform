'use client';

import { Checkbox, Input } from '@broker/ui';
import { updatePlatformSettingsAction } from '@/lib/crypto/actions';
import { ActionForm } from '../_money/ActionForm';

/**
 * Форма денежных настроек платформы. Фаза 2 — только вид (карточки-чекбоксы
 * с последствием, суммы с валютой); имена полей и action прежние.
 */

function Gate({
  name,
  defaultChecked,
  title,
  on,
  off,
}: {
  name: string;
  defaultChecked: boolean;
  title: string;
  on: string;
  off: string;
}) {
  return (
    <label className="border-border bg-sunken hover:border-border-strong flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5">
      <Checkbox name={name} defaultChecked={defaultChecked} className="mt-0.5 size-4" />
      <span className="min-w-0">
        <span className="text-primary block text-sm font-medium">{title}</span>
        <span className="text-muted block text-xs">Включено: {on}</span>
        <span className="text-muted block text-xs">Выключено: {off}</span>
      </span>
    </label>
  );
}

function Minimum({ name, label, defaultValue }: { name: string; label: string; defaultValue: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-muted block text-xs">{label}</span>
      <span className="relative block w-48">
        <Input
          name={name}
          defaultValue={defaultValue}
          controlSize="compact"
          inputMode="decimal"
          autoComplete="off"
          className="pr-14 text-right tabular-nums"
        />
        <span className="text-muted pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs">
          USDT
        </span>
      </span>
    </label>
  );
}

export function SettingsForm({
  initial,
}: {
  initial: { depositRequiresKyc: boolean; withdrawRequiresKyc: boolean; minDeposit: string; minWithdraw: string };
}) {
  return (
    <ActionForm
      action={updatePlatformSettingsAction}
      submitLabel="Сохранить настройки"
      okText="Сохранено, запись в журнале."
      reasonPlaceholder="Почему меняются правила для всех клиентов"
    >
      <div className="grid gap-3 lg:grid-cols-2">
        <Gate
          name="depositRequiresKyc"
          defaultChecked={initial.depositRequiresKyc}
          title="Ввод только после KYC"
          on="пополнить счёт может только верифицированный клиент."
          off="пополнение доступно до верификации."
        />
        <Gate
          name="withdrawRequiresKyc"
          defaultChecked={initial.withdrawRequiresKyc}
          title="Вывод только после KYC"
          on="заявку на вывод принимают только от верифицированного."
          off="вывод доступен без верификации."
        />
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <Minimum name="minDeposit" label="Минимальный ввод" defaultValue={initial.minDeposit} />
        <Minimum name="minWithdraw" label="Минимальный вывод" defaultValue={initial.minWithdraw} />
      </div>
      <p className="text-muted -mt-1 text-xs">Сумма в USDT, до двух знаков после запятой; 0 — без минимума.</p>
    </ActionForm>
  );
}
