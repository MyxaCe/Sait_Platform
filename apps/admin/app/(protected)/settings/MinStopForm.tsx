'use client';

import { Input } from '@broker/ui';
import { updateMinStopAction } from '@/lib/crypto/actions';
import { ActionForm } from '../_money/ActionForm';

/**
 * Минимальное расстояние SL/TP (б.п.) — значение живёт в терминале. Форма
 * с основанием; сохранение = вызов терминала, при отказе/молчании — ошибка,
 * ничего не записано. `initial = null` — терминал не ответил на чтение:
 * поле пустое, оператор вводит значение сам.
 */
export function MinStopForm({ initial }: { initial: number | null }) {
  return (
    <ActionForm
      action={updateMinStopAction}
      submitLabel="Сохранить в терминале"
      okText="Терминал принял значение, запись в журнале."
      reasonPlaceholder="Почему меняется минимальное расстояние стопов для всех клиентов"
    >
      <label className="block space-y-1.5">
        <span className="text-muted block text-xs">Минимальное расстояние стоп-лосса/тейк-профита, bps</span>
        <span className="relative block w-48">
          <Input
            name="minStopBps"
            defaultValue={initial === null ? '' : String(initial)}
            controlSize="compact"
            inputMode="numeric"
            autoComplete="off"
            className="pr-12 text-right tabular-nums"
          />
          <span className="text-muted pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs">bps</span>
        </span>
      </label>
      <p className="text-muted -mt-1 text-xs">
        Целое от 0 до 10 000. 10 bps = 0,1 % от цены: при цене 50 000 стоп не ближе 50. 0 — без ограничения.
      </p>
    </ActionForm>
  );
}
