'use client';

import { Select } from '@broker/ui';
import { setClientMoneyFlagsAction } from '@/lib/crypto/actions';
import { ActionForm } from '../../../_money/ActionForm';

/**
 * Денежные флаги клиента (дизайн §3) — форма-с-основанием, admin и
 * finance_operator. Заморозка вызывает терминал `trading-freeze` реального
 * счёта ДО записи флага: терминал не ответил/отказал — флаг не ставится.
 *
 * Редизайн фазы 1: только вид (сетка полей, плотные контролы, описания под
 * чекбоксами). Имена полей и action — прежние.
 */

const KYC_OPTIONS = [
  { value: 'inherit', label: 'Наследовать из платформы' },
  { value: 'required', label: 'Да — только после KYC' },
  { value: 'not_required', label: 'Нет — без KYC' },
];

function Check({
  name,
  defaultChecked,
  title,
  hint,
}: {
  name: string;
  defaultChecked: boolean;
  title: string;
  hint: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-sunken px-3 py-2.5 hover:border-border-strong">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-0.5 size-4 shrink-0 accent-[rgb(var(--negative))]"
      />
      <span>
        <span className="block text-sm font-medium text-primary">{title}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </label>
  );
}

export function MoneyFlagsPanel({
  userId,
  flags,
}: {
  userId: string;
  flags: { depositKyc: string; withdrawKyc: string; frozen: boolean; withdrawBanned: boolean };
}) {
  return (
    <ActionForm action={setClientMoneyFlagsAction} submitLabel="Сохранить флаги" okText="Флаги сохранены, запись в журнале.">
      <input type="hidden" name="userId" value={userId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="block text-xs text-muted">Ввод только после KYC</span>
          <Select controlSize="compact" name="depositKyc" defaultValue={flags.depositKyc}>
            {KYC_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="block space-y-1.5">
          <span className="block text-xs text-muted">Вывод только после KYC</span>
          <Select controlSize="compact" name="withdrawKyc" defaultValue={flags.withdrawKyc}>
            {KYC_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </label>
        <Check
          name="frozen"
          defaultChecked={flags.frozen}
          title="Заморозка реального счёта"
          hint="Нет торговли и вывода; закрытие позиций работает. Сначала ставится в терминале."
        />
        <Check
          name="withdrawBanned"
          defaultChecked={flags.withdrawBanned}
          title="Запрет вывода"
          hint="Ввод и торговля доступны, заявки на вывод не принимаются."
        />
      </div>
    </ActionForm>
  );
}
