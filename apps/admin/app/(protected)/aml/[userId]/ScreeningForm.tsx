'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@broker/ui';
import { recordScreeningAction, type ScreeningState } from '@/lib/aml/actions';
import { SANCTIONS_LISTS } from '@/lib/aml/lists';

/**
 * Форма фиксации результата ручного AML-скрининга (ADM-14). Один server action:
 * оператор отмечает, по каким спискам сверял, выбирает исход (проверено /
 * найдено→эскалация) и указывает основание. Личность оператора форма НЕ
 * передаёт — её берёт action из сессии (Р-451). Проверку оператор делает во
 * внешних источниках; здесь — только РЕЗУЛЬТАТ.
 */

const MESSAGES: Record<string, string> = {
  invalidClient: 'Клиент не указан.',
  invalidOutcome: 'Выберите исход сверки.',
  noLists: 'Отметьте хотя бы один список, по которому сверяли.',
  missingReason: 'Укажите основание — что именно сверено и каков результат.',
  noClient: 'Клиента не существует.',
};

function Notice({ state }: { state: ScreeningState }) {
  if (state.ok) {
    return (
      <p
        role="status"
        className="rounded border border-positive/40 bg-positive/10 px-3 py-2 text-sm text-positive"
      >
        Результат сверки зафиксирован и записан в журнал.
      </p>
    );
  }
  if (!state.error) return null;
  return (
    <p
      role="alert"
      className="rounded border border-negative/40 bg-negative/10 px-3 py-2 text-sm text-negative"
    >
      {MESSAGES[state.error] ?? 'Результат не записан.'}
    </p>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? '…' : 'Зафиксировать результат'}
    </Button>
  );
}

export function ScreeningForm({ userId }: { userId: string }) {
  const [state, formAction] = useFormState<ScreeningState, FormData>(recordScreeningAction, {});

  return (
    <form action={formAction} className="space-y-4 rounded border border-border bg-elevated p-4">
      <Notice state={state} />
      <input type="hidden" name="userId" value={userId} />

      <fieldset className="space-y-2">
        <legend className="text-sm text-secondary">Сверено по спискам</legend>
        <div className="flex flex-wrap gap-4">
          {SANCTIONS_LISTS.map((l) => (
            <label key={l.id} className="flex items-center gap-2 text-sm text-primary">
              <input type="checkbox" name="lists" value={l.id} className="accent-accent" />
              {l.label}
              <span className="text-xs text-secondary">({l.authority})</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2 border-t border-border pt-4">
        <legend className="text-sm text-secondary">Исход</legend>
        <label className="flex items-center gap-2 text-sm text-primary">
          <input type="radio" name="outcome" value="clear" className="accent-accent" />
          Проверено — совпадений нет
        </label>
        <label className="flex items-center gap-2 text-sm text-primary">
          <input type="radio" name="outcome" value="escalated" className="accent-accent" />
          Найдено — на эскалацию
        </label>
      </fieldset>

      <div className="space-y-2 border-t border-border pt-4">
        <label htmlFor="reason" className="block text-sm text-secondary">
          Основание
        </label>
        <textarea
          id="reason"
          name="reason"
          rows={3}
          className="w-full rounded border border-border bg-base px-3 py-2 text-sm text-primary outline-none focus:border-accent"
          placeholder="Что сверено и каков результат (напр. «сверка по OFSI/OFAC/EU — совпадений нет» или «совпадение по OFAC, детали…»)"
        />
      </div>

      <SubmitButton />
    </form>
  );
}
