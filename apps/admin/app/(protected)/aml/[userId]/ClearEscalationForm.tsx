'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@broker/ui';
import { clearEscalationAction, type ScreeningState } from '@/lib/aml/actions';

/**
 * Снятие AML-эскалации (ложное срабатывание) — ТОЛЬКО admin (ADM-14, Р-456 D).
 * Отдельное действие, обратное авто-блоку: разблокирует клиента и переводит
 * AML-статус в «clear». Основание обязательно (кто/когда/почему признано
 * ложным). Личность — из сессии (Р-451); в форме только userId и reason.
 */

const MESSAGES: Record<string, string> = {
  forbidden: 'Снятие эскалации доступно только администратору.',
  invalidClient: 'Клиент не указан.',
  missingReason: 'Укажите основание — почему совпадение признано ложным.',
  notEscalated: 'Клиент не в состоянии эскалации — снимать нечего.',
  noClient: 'Клиента не существует.',
};

function Notice({ state }: { state: ScreeningState }) {
  if (state.ok) {
    return (
      <p
        role="status"
        className="rounded border border-positive/40 bg-positive/10 px-3 py-2 text-sm text-positive"
      >
        Эскалация снята: клиент разблокирован, статус переведён в «проверено». Записано в журнал.
      </p>
    );
  }
  if (!state.error) return null;
  return (
    <p
      role="alert"
      className="rounded border border-negative/40 bg-negative/10 px-3 py-2 text-sm text-negative"
    >
      {MESSAGES[state.error] ?? 'Эскалация не снята.'}
    </p>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="danger" disabled={pending}>
      {pending ? '…' : 'Снять эскалацию и разблокировать'}
    </Button>
  );
}

export function ClearEscalationForm({ userId }: { userId: string }) {
  const [state, formAction] = useFormState<ScreeningState, FormData>(clearEscalationAction, {});

  return (
    <form action={formAction} className="space-y-3 rounded border border-border bg-elevated p-4">
      <Notice state={state} />
      <p className="text-sm text-secondary">
        Снимайте только после РУЧНОЙ проверки совпадения. Действие разблокирует клиента и
        фиксирует основание в журнале.
      </p>
      <input type="hidden" name="userId" value={userId} />
      <label htmlFor="clearReason" className="block text-sm text-secondary">
        Основание (почему совпадение признано ложным)
      </label>
      <textarea
        id="clearReason"
        name="reason"
        rows={3}
        className="w-full rounded border border-border bg-base px-3 py-2 text-sm text-primary outline-none focus:border-accent"
        placeholder="Что проверено вручную и почему совпадение признано ложным срабатыванием"
      />
      <SubmitButton />
    </form>
  );
}
