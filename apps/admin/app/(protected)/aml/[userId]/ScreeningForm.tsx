'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Button, Callout, Checkbox, Textarea, cn } from '@broker/ui';
import { recordScreeningAction, type ScreeningState } from '@/lib/aml/actions';
import { REQUIRED_LISTS_FOR_CLEAR, SANCTIONS_LISTS, type AmlOutcome, type SanctionsListId } from '@/lib/aml/lists';

/**
 * Фиксация результата ручного AML-скрининга (ADM-14; концепция §6.6, §6.7).
 * Прежний server action `recordScreeningAction`, прежние поля формы
 * (`userId`, `lists`, `outcome`, `reason`); личность — из сессии (Р-451).
 *
 * Вид: списки и исход — карточки-выборы; основание обязательно. Исход
 * «найдено» блокирует клиента автоматически (Р-456 D) — поэтому он
 * двухшаговый: спокойная красная обводка → подтверждение с последствиями.
 * Подсказка «для „совпадений нет“ нужны все три списка» — сразу у выбора;
 * сервер проверяет то же самое сам.
 */

const MESSAGES: Record<string, string> = {
  invalidClient: 'Клиент не указан.',
  invalidOutcome: 'Выберите исход сверки.',
  noLists: 'Отметьте хотя бы один список, по которому сверяли.',
  listsIncompleteForClear:
    'Для «совпадений нет» нужно свериться по всем трём спискам (OFSI, OFAC, EU consolidated).',
  missingReason: 'Укажите основание — что именно сверено и каков результат.',
  noClient: 'Клиента не существует.',
};

function Submit({ variant, children, disabled }: { variant: 'primary' | 'danger'; children: string; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="compact" variant={variant} loading={pending} disabled={pending || disabled} className="w-full">
      {children}
    </Button>
  );
}

export function ScreeningForm({ userId }: { userId: string }) {
  const [state, formAction] = useFormState<ScreeningState, FormData>(recordScreeningAction, {});
  const [lists, setLists] = useState<SanctionsListId[]>([]);
  const [outcome, setOutcome] = useState<AmlOutcome | null>(null);
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);

  const allForClear = REQUIRED_LISTS_FOR_CLEAR.every((id) => lists.includes(id));
  const ready = outcome !== null && lists.length > 0 && reason.trim().length > 0 && (outcome !== 'clear' || allForClear);
  const reset = () => setConfirm(false);

  return (
    <form action={formAction} className="space-y-4">
      {state.ok ? (
        <Callout tone="positive">Результат сверки зафиксирован, запись в журнале.</Callout>
      ) : state.error ? (
        <Callout tone="negative">{MESSAGES[state.error] ?? 'Результат не записан.'}</Callout>
      ) : null}

      <fieldset className="space-y-1.5">
        <legend className="mb-1.5 text-xs text-muted">Сверено по спискам</legend>
        {SANCTIONS_LISTS.map((l) => {
          const on = lists.includes(l.id);
          return (
            <label
              key={l.id}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2',
                on ? 'border-accent/50 bg-accent/[0.06]' : 'border-border hover:bg-primary/[0.03]',
              )}
            >
              <Checkbox
                name="lists"
                value={l.id}
                checked={on}
                className="size-4"
                onChange={(e) => {
                  setLists((prev) => (e.target.checked ? [...prev, l.id] : prev.filter((x) => x !== l.id)));
                  reset();
                }}
              />
              <span className="min-w-0 text-[13px]">
                <span className="font-medium text-primary">{l.label}</span>
                <span className="text-muted"> · {l.authority}</span>
              </span>
            </label>
          );
        })}
      </fieldset>

      <fieldset className="space-y-1.5">
        <legend className="mb-1.5 text-xs text-muted">Исход</legend>
        {(
          [
            { value: 'clear', title: 'Совпадений нет', hint: 'нужны все три списка' },
            { value: 'escalated', title: 'Найдено — эскалация', hint: 'клиент будет заблокирован автоматически' },
          ] as const
        ).map((o) => {
          const on = outcome === o.value;
          return (
            <label
              key={o.value}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2',
                on
                  ? o.value === 'escalated'
                    ? 'border-negative/50 bg-negative/[0.06]'
                    : 'border-positive/50 bg-positive/[0.06]'
                  : 'border-border hover:bg-primary/[0.03]',
              )}
            >
              <input
                type="radio"
                name="outcome"
                value={o.value}
                checked={on}
                onChange={() => {
                  setOutcome(o.value);
                  reset();
                }}
                className="mt-0.5 size-4 accent-accent"
              />
              <span className="text-[13px]">
                <span className={cn('block font-medium', o.value === 'escalated' ? 'text-negative' : 'text-primary')}>
                  {o.title}
                </span>
                <span className="block text-xs text-muted">{o.hint}</span>
              </span>
            </label>
          );
        })}
        {outcome === 'clear' && lists.length > 0 && !allForClear ? (
          <p className="text-xs text-warning">Отметьте все три списка — иначе «совпадений нет» не принимается.</p>
        ) : null}
      </fieldset>

      <div className="space-y-1">
        <label htmlFor="aml-reason" className="block text-xs text-muted">
          Основание
        </label>
        <Textarea
          id="aml-reason"
          name="reason"
          rows={3}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            reset();
          }}
          placeholder="Что сверено и каков результат: «OFSI/OFAC/EU — совпадений нет» или «совпадение по OFAC, детали…»"
        />
        <p className="text-xs text-muted">Обязательно. Пишется в неизменяемый журнал.</p>
      </div>

      {outcome === 'escalated' ? (
        confirm ? (
          <div className="space-y-2 rounded-md border border-negative/30 bg-negative/[0.05] p-3">
            <p className="text-[13px] text-negative">
              Эскалировать? Клиент будет заблокирован сразу: вход в кабинет и терминал закроется,
              сессии погаснут. Снять эскалацию сможет только администратор.
            </p>
            <div className="flex gap-2">
              <Submit variant="danger" disabled={!ready}>
                Да, эскалировать
              </Submit>
              <Button type="button" size="compact" variant="secondary" onClick={reset}>
                Отмена
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            size="compact"
            variant="danger-outline"
            className="w-full"
            disabled={!ready}
            onClick={() => setConfirm(true)}
          >
            Эскалировать и заблокировать…
          </Button>
        )
      ) : (
        <Submit variant="primary" disabled={!ready}>
          Зафиксировать результат
        </Submit>
      )}
      {/* В конце: скрытое поле не должно получать отступ space-y. */}
      <input type="hidden" name="userId" value={userId} />
    </form>
  );
}
