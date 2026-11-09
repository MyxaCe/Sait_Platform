'use client';

import { setClientMoneyFlagsAction } from '@/lib/crypto/actions';
import { ActionForm } from '../../../_money/ActionForm';

/**
 * Денежные флаги клиента (дизайн §3) — форма-с-основанием, admin и
 * finance_operator. Заморозка вызывает терминал `trading-freeze` реального
 * счёта ДО записи флага: терминал не ответил/отказал — флаг не ставится.
 */

const selectCls =
  'rounded border border-border bg-base px-2 py-1 text-sm text-primary outline-none focus:border-accent';

const KYC_OPTIONS = [
  { value: 'inherit', label: 'наследовать из платформы' },
  { value: 'required', label: 'да — только после KYC' },
  { value: 'not_required', label: 'нет — без KYC' },
];

export function MoneyFlagsPanel({
  userId,
  flags,
}: {
  userId: string;
  flags: { depositKyc: string; withdrawKyc: string; frozen: boolean; withdrawBanned: boolean };
}) {
  return (
    <div className="rounded border border-border bg-elevated p-4">
      <ActionForm action={setClientMoneyFlagsAction} submitLabel="Сохранить флаги" okText="Флаги сохранены, запись в журнале.">
        <input type="hidden" name="userId" value={userId} />
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span className="w-40 text-secondary">Ввод после KYC</span>
          <select name="depositKyc" defaultValue={flags.depositKyc} className={selectCls}>
            {KYC_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span className="w-40 text-secondary">Вывод после KYC</span>
          <select name="withdrawKyc" defaultValue={flags.withdrawKyc} className={selectCls}>
            {KYC_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="frozen" defaultChecked={flags.frozen} />
          Заморозка счёта — реальный счёт: нет торговли и вывода (закрытие позиций работает)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="withdrawBanned" defaultChecked={flags.withdrawBanned} />
          Запрет вывода
        </label>
      </ActionForm>
    </div>
  );
}
