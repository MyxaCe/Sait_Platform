'use client';

import { useState, type ReactNode } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Button, Callout } from '@broker/ui';
import type { MoneyActionState } from '@/lib/crypto/actions';
import { moneyErrorText } from '@/lib/crypto/labels';

/**
 * Форма-с-основанием денежной зоны: обязательное поле «Основание», submit
 * заблокирован без него; `danger` — подтверждение вторым кликом. Личность
 * оператора форма не несёт (из сессии, Р-451). Поля действия — `children`.
 *
 * Редизайн (фаза 1) поменял ТОЛЬКО вид: плотные контролы, Callout для
 * результата, спокойная красная обводка у первого шага danger. Логика, имена
 * полей и порядок шагов — прежние.
 */

function Submit({
  label,
  variant,
  disabled,
}: {
  label: string;
  variant: 'primary' | 'secondary' | 'danger';
  disabled: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="compact"
      variant={variant}
      loading={pending}
      disabled={pending || disabled}
    >
      {label}
    </Button>
  );
}

export function ActionForm({
  action,
  submitLabel,
  okText,
  children,
  variant = 'primary',
  danger = false,
  reasonPlaceholder = 'Основание (обязательно)',
  extraValid = true,
}: {
  action: (state: MoneyActionState, fd: FormData) => Promise<MoneyActionState>;
  submitLabel: string;
  okText: string;
  children?: ReactNode;
  variant?: 'primary' | 'secondary' | 'danger';
  danger?: boolean;
  reasonPlaceholder?: string;
  /** Доп. условие активности submit (напр. заполнен хэш). */
  extraValid?: boolean;
}) {
  const [state, formAction] = useFormState<MoneyActionState, FormData>(action, {});
  const [reason, setReason] = useState('');
  const [armed, setArmed] = useState(false);
  const valid = reason.trim().length > 0 && extraValid;

  return (
    <form action={formAction} className="space-y-3">
      {state.error ? (
        <Callout tone="negative">{moneyErrorText(state.error, state.detail)}</Callout>
      ) : state.ok ? (
        <Callout tone="positive">{okText}</Callout>
      ) : null}
      {children}
      <input
        name="reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={reasonPlaceholder}
        aria-label="Основание — обязательно, пишется в журнал"
        className="border-border-strong bg-sunken text-primary placeholder:text-muted focus:border-accent/70 focus:ring-accent/20 h-9 w-full rounded-md border px-3 text-sm focus:outline-none focus:ring-2"
      />
      {danger && !armed ? (
        <Button
          type="button"
          size="compact"
          variant="danger-outline"
          disabled={!valid}
          onClick={() => setArmed(true)}
        >
          {submitLabel}
        </Button>
      ) : (
        <div className="flex items-center gap-2">
          <Submit
            label={danger ? `Да, ${submitLabel.toLowerCase()}` : submitLabel}
            variant={danger ? 'danger' : variant}
            disabled={!valid}
          />
          {danger ? (
            <Button
              type="button"
              size="compact"
              variant="secondary"
              onClick={() => setArmed(false)}
            >
              Отмена
            </Button>
          ) : null}
        </div>
      )}
    </form>
  );
}
