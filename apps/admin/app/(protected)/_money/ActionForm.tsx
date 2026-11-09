'use client';

import { useState, type ReactNode } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@broker/ui';
import type { MoneyActionState } from '@/lib/crypto/actions';
import { moneyErrorText } from '@/lib/crypto/labels';

/**
 * Форма-с-основанием денежной зоны: обязательное поле «Основание», submit
 * заблокирован без него; `danger` — подтверждение вторым кликом. Личность
 * оператора форма не несёт (из сессии, Р-451). Поля действия — `children`.
 */

function Submit({ label, variant, disabled }: { label: string; variant: 'primary' | 'secondary' | 'danger'; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} disabled={pending || disabled}>
      {pending ? '…' : label}
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
    <form action={formAction} className="space-y-2">
      {state.error ? (
        <p role="alert" className="rounded border border-negative/40 bg-negative/10 px-2 py-1 text-xs text-negative">
          {moneyErrorText(state.error, state.detail)}
        </p>
      ) : state.ok ? (
        <p role="status" className="rounded border border-positive/40 bg-positive/10 px-2 py-1 text-xs text-positive">
          {okText}
        </p>
      ) : null}
      {children}
      <input
        name="reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={reasonPlaceholder}
        className="w-full rounded border border-border bg-base px-2 py-1 text-sm text-primary outline-none focus:border-accent"
      />
      {danger && !armed ? (
        <Button type="button" size="sm" variant="danger" disabled={!valid} onClick={() => setArmed(true)}>
          {submitLabel}
        </Button>
      ) : (
        <div className="flex gap-2">
          <Submit label={danger ? `Да, ${submitLabel.toLowerCase()}` : submitLabel} variant={danger ? 'danger' : variant} disabled={!valid} />
          {danger ? (
            <Button type="button" size="sm" variant="secondary" onClick={() => setArmed(false)}>
              Отмена
            </Button>
          ) : null}
        </div>
      )}
    </form>
  );
}
