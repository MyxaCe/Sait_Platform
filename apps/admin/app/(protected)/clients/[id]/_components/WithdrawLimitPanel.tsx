'use client';

import { useState } from 'react';
import { Input, Select } from '@broker/ui';
import { setClientWithdrawLimitAction } from '@/lib/crypto/actions';
import { ActionForm } from '../../../_money/ActionForm';

/**
 * Лимит вывода без верификации — переопределение у клиента (admin и
 * finance_operator, как денежные флаги). «Наследовать» — процент из настроек
 * платформы; «Свой» — процент для этого клиента (0 — без верификации вывода
 * нет). Форма-с-основанием, запись в журнал (до/после).
 */
export function WithdrawLimitPanel({
  userId,
  overridePct,
  platformPct,
}: {
  userId: string;
  /** Своё значение клиента в процентах строкой; `null` — наследует. */
  overridePct: string | null;
  platformPct: string;
}) {
  const [mode, setMode] = useState<'inherit' | 'own'>(overridePct === null ? 'inherit' : 'own');
  return (
    <ActionForm
      action={setClientWithdrawLimitAction}
      submitLabel="Сохранить лимит"
      okText="Лимит сохранён, запись в журнале."
      reasonPlaceholder="Почему клиенту меняется лимит вывода без верификации"
    >
      <input type="hidden" name="userId" value={userId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="block text-xs text-muted">Лимит вывода без верификации</span>
          <Select
            controlSize="compact"
            name="mode"
            value={mode}
            onChange={(e) => setMode(e.target.value === 'own' ? 'own' : 'inherit')}
          >
            <option value="inherit">Наследовать из платформы ({platformPct} %)</option>
            <option value="own">Свой для клиента</option>
          </Select>
        </label>
        <label className="block space-y-1.5">
          <span className="block text-xs text-muted">Свой лимит, % от баланса до выводов</span>
          <span className="relative block w-40">
            <Input
              name="pct"
              defaultValue={overridePct ?? platformPct}
              disabled={mode === 'inherit'}
              controlSize="compact"
              inputMode="decimal"
              autoComplete="off"
              className="pr-10 text-right tabular-nums"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">%</span>
          </span>
        </label>
      </div>
      <p className="-mt-1 text-xs text-muted">
        Суммарно за всё время; 0 — без верификации вывод запрещён. Действует, только пока для клиента
        «Вывод только после KYC» и верификация не пройдена.
      </p>
    </ActionForm>
  );
}
