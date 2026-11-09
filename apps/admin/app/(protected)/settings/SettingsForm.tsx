'use client';

import { updatePlatformSettingsAction } from '@/lib/crypto/actions';
import { ActionForm } from '../_money/ActionForm';

const inputCls =
  'w-32 rounded border border-border bg-base px-2 py-1 text-sm tabular-nums text-primary outline-none focus:border-accent';

export function SettingsForm({
  initial,
}: {
  initial: { depositRequiresKyc: boolean; withdrawRequiresKyc: boolean; minDeposit: string; minWithdraw: string };
}) {
  return (
    <ActionForm action={updatePlatformSettingsAction} submitLabel="Сохранить" okText="Сохранено, запись в журнале.">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="depositRequiresKyc" defaultChecked={initial.depositRequiresKyc} />
        Ввод только после KYC
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="withdrawRequiresKyc" defaultChecked={initial.withdrawRequiresKyc} />
        Вывод только после KYC
      </label>
      <label className="flex items-center gap-2 text-sm">
        <span className="w-48 text-secondary">Минимальный ввод, USDT</span>
        <input name="minDeposit" defaultValue={initial.minDeposit} className={inputCls} inputMode="decimal" />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <span className="w-48 text-secondary">Минимальный вывод, USDT</span>
        <input name="minWithdraw" defaultValue={initial.minWithdraw} className={inputCls} inputMode="decimal" />
      </label>
    </ActionForm>
  );
}
