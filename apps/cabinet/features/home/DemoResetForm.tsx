'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@broker/ui';
import { resetDemoAccountAction, type DemoResetOutcome } from '@/lib/actions';

/**
 * Сброс демо-счёта с видимым исходом (WEB-42).
 *
 * **Что было.** Форма уходила в действие, возвращавшее пустоту.
 * Нажатие не давало отклика **вообще**: страница перерисовывалась со
 * старым числом — событие ещё не приехало, — а отказ терминала уходил
 * в серверный лог. Для человека успех и отказ выглядели одинаково.
 *
 * **Два утверждения в два момента, и одно не заменяет другое.** Здесь
 * — «принято»: мы знаем ровно то, что терминал принял команду. Что
 * сброс **применился**, мы узнаём событием, и об этом приходит
 * уведомление. Сказать здесь «сброшено» значило бы утверждать
 * результат, которого мы не видели.
 */
const INITIAL: DemoResetOutcome = { state: 'idle' };

/** Ключ подписи по исходу. Незнакомая причина — общий текст. */
function messageKey(outcome: DemoResetOutcome): string | null {
  switch (outcome.state) {
    case 'idle':
      return null;
    case 'accepted':
      return 'resetAccepted';
    case 'too-often':
      return 'resetTooOften';
    case 'no-session':
      return 'resetNoSession';
    case 'unavailable':
      // Канальная ось: до терминала не дошли. Человеку чинить нечего,
      // и обещать ему «попробуйте позже» честнее, чем молчать.
      return 'resetUnavailable';
    case 'refused':
      switch (outcome.reason) {
        case 'account_not_flat':
          return 'resetPositionsOpen';
        case 'not_a_demo_account':
          return 'resetNotDemo';
        default:
          // Терминал мог завести причину раньше, чем мы о ней узнали.
          return 'resetRefused';
      }
  }
}

/** Отказ и успех различаются не только словами: цветом тоже. */
function tone(outcome: DemoResetOutcome): string {
  return outcome.state === 'accepted' ? 'text-secondary' : 'text-negative';
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="ghost" disabled={pending}>
      {label}
    </Button>
  );
}

export function DemoResetForm({
  label,
  texts,
}: {
  label: string;
  /** Готовые переводы по ключам: клиентский компонент их не ищет сам. */
  texts: Record<string, string>;
}) {
  const [outcome, action] = useFormState(resetDemoAccountAction, INITIAL);
  const key = messageKey(outcome);

  return (
    <form action={action} className="mt-3">
      <SubmitButton label={label} />
      {key && (
        <p className={`mt-1 text-xs ${tone(outcome)}`} role="status" aria-live="polite">
          {texts[key] ?? texts.resetRefused}
        </p>
      )}
    </form>
  );
}
