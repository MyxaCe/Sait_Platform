'use client';

import { useState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Callout, Textarea, cn } from '@broker/ui';

/**
 * Локальные примитивы форм-с-основанием зоны «Контроль» (операторы, риск).
 * Повторяют образцы фазы 1 (`clients/[id]/_components/BlockPanel.tsx`):
 * подпись сверху `text-xs`, контрол `compact`, основание — Textarea с
 * подсказкой «пишется в неизменяемый журнал», опасное — в два шага.
 *
 * Кандидаты в @broker/ui (Field, ReasonField, ArmedSubmit) — пакет в фазе 2
 * не трогаем, поэтому живут здесь.
 */

export function Field({
  label,
  htmlFor,
  hint,
  error,
  className,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-secondary text-xs font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-negative text-xs">
          {error}
        </p>
      ) : hint ? (
        <p className="text-muted text-xs">{hint}</p>
      ) : null}
    </div>
  );
}

/** «Основание» — обязательное поле каждого изменяющего действия (§6.6). */
export function ReasonField({
  id,
  value,
  onChange,
  label = 'Основание',
  placeholder = 'Почему вы это делаете (обязательно)',
  name = 'reason',
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  label?: string;
  placeholder?: string;
  name?: string;
}) {
  return (
    <Field label={label} htmlFor={id} hint="Пишется в неизменяемый журнал вместе с вашим именем.">
      <Textarea
        id={id}
        name={name}
        rows={2}
        value={value}
        required
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </Field>
  );
}

/** Submit формы с индикатором отправки (спиннер, а не «…»). */
export function SubmitButton({
  children,
  variant = 'primary',
  disabled = false,
  className,
}: {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'danger' | 'danger-outline';
  disabled?: boolean;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="compact"
      variant={variant}
      loading={pending}
      disabled={pending || disabled}
      className={className}
    >
      {children}
    </Button>
  );
}

/**
 * Двухшаговое подтверждение опасного действия внутри формы (§6.7): первый шаг —
 * спокойная `danger-outline`; после клика — текст последствий и `danger`
 * «Да, …» + «Отмена». `resetKey` — смена основания снимает взвод.
 */
export function ArmedSubmit({
  idle,
  confirm,
  consequence,
  disabled,
  resetKey,
}: {
  idle: string;
  confirm: string;
  consequence: ReactNode;
  disabled: boolean;
  resetKey?: string;
}) {
  const [armedFor, setArmedFor] = useState<string | null>(null);
  const armed = armedFor !== null && armedFor === (resetKey ?? '');
  if (!armed) {
    return (
      <Button
        type="button"
        size="compact"
        variant="danger-outline"
        disabled={disabled}
        onClick={() => setArmedFor(resetKey ?? '')}
      >
        {idle}
      </Button>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-negative text-[13px]">{consequence}</p>
      <div className="flex flex-wrap gap-2">
        <SubmitButton variant="danger" disabled={disabled}>
          {confirm}
        </SubmitButton>
        <Button type="button" size="compact" variant="secondary" onClick={() => setArmedFor(null)}>
          Отмена
        </Button>
      </div>
    </div>
  );
}

/** Результат действия — Callout над формой (§6.6), не исчезает сам. */
export function ActionResult({
  state,
  okText,
  messages,
}: {
  state: { ok?: boolean; error?: string };
  okText: ReactNode;
  messages: Record<string, string>;
}) {
  if (state.error) {
    return <Callout tone="negative">{messages[state.error] ?? 'Действие не выполнено.'}</Callout>;
  }
  if (state.ok) return <Callout tone="positive">{okText}</Callout>;
  return null;
}
