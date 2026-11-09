'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Button, Callout, Textarea } from '@broker/ui';
import { clearEscalationAction, type ScreeningState } from '@/lib/aml/actions';

/**
 * Снятие AML-эскалации (ложное срабатывание) — ТОЛЬКО admin (ADM-14, Р-456 D).
 * Прежний server action `clearEscalationAction` (роль проверяется на сервере
 * повторно); в форме только `userId` и `reason`, личность — из сессии.
 *
 * Вид (концепция §6.7): живёт в «Опасной зоне», двухшаговое — основание →
 * спокойная красная обводка → подтверждение с последствиями.
 */

const MESSAGES: Record<string, string> = {
  forbidden: 'Снятие эскалации доступно только администратору.',
  invalidClient: 'Клиент не указан.',
  missingReason: 'Укажите основание — почему совпадение признано ложным.',
  notEscalated: 'Клиент не в состоянии эскалации — снимать нечего.',
  noClient: 'Клиента не существует.',
};

function Submit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="compact" variant="danger" loading={pending} disabled={pending || disabled}>
      Да, снять и разблокировать
    </Button>
  );
}

export function ClearEscalationForm({ userId }: { userId: string }) {
  const [state, formAction] = useFormState<ScreeningState, FormData>(clearEscalationAction, {});
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const empty = reason.trim().length === 0;

  return (
    <form action={formAction} className="space-y-3">
      {state.ok ? (
        <Callout tone="positive">
          Эскалация снята: клиент разблокирован, статус — «чисто». Запись в журнале.
        </Callout>
      ) : state.error ? (
        <Callout tone="negative">{MESSAGES[state.error] ?? 'Эскалация не снята.'}</Callout>
      ) : null}
      <div className="space-y-1">
        <label htmlFor="clear-reason" className="block text-xs text-muted">
          Основание: почему совпадение ложное
        </label>
        <Textarea
          id="clear-reason"
          name="reason"
          rows={3}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setConfirm(false);
          }}
          placeholder="Что проверено вручную и почему это ложное срабатывание (обязательно)"
        />
      </div>
      {confirm ? (
        <div className="space-y-2">
          <p className="text-[13px] text-negative">
            Снять эскалацию? Клиент будет разблокирован сразу, AML-статус станет «чисто». Решение
            записывается на вас.
          </p>
          <div className="flex gap-2">
            <Submit disabled={empty} />
            <Button type="button" size="compact" variant="secondary" onClick={() => setConfirm(false)}>
              Отмена
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" size="compact" variant="danger-outline" disabled={empty} onClick={() => setConfirm(true)}>
          Снять эскалацию…
        </Button>
      )}
      {/* В конце: скрытое поле не должно получать отступ space-y. */}
      <input type="hidden" name="userId" value={userId} />
    </form>
  );
}
