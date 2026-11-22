'use client';

import { useState, type ReactNode } from 'react';
import { Button } from '../../atoms/Button/Button';
import { Input } from '../../atoms/Input/Input';
import { Select } from '../../atoms/Select/Select';
import { FormField } from '../../molecules/FormField/FormField';
import { cn } from '../../lib/cn';

export interface ReasonFormProps {
  action: (formData: FormData) => void | Promise<void>;
  reasons?: string[];
  reasonName?: string;
  reasonLabel?: string;
  requireReason?: boolean;
  danger?: boolean;
  submitLabel?: string;
  confirmLabel?: string;
  reference?: { name?: string; label?: string; placeholder?: string };
  children?: ReactNode;
  error?: string;
  pending?: boolean;
  className?: string;
}

interface SubmitProps {
  danger: boolean;
  armed: boolean;
  canSubmit: boolean;
  pending: boolean;
  submitLabel: string;
  confirmLabel: string;
  onArm: () => void;
  onDisarm: () => void;
}

function SubmitRow({
  danger,
  armed,
  canSubmit,
  pending,
  submitLabel,
  confirmLabel,
  onArm,
  onDisarm,
}: SubmitProps) {
  if (danger && !armed) {
    return (
      <Button type="button" variant="danger" disabled={!canSubmit} onClick={onArm}>
        {submitLabel}
      </Button>
    );
  }

  if (danger && armed) {
    return (
      <div className="flex items-center gap-3">
        <Button type="submit" variant="danger" loading={pending} disabled={!canSubmit}>
          {confirmLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={onDisarm} disabled={pending}>
          Отмена
        </Button>
        <span className="text-xs text-negative">Подтвердите необратимое действие.</span>
      </div>
    );
  }

  return (
    <Button type="submit" loading={pending} disabled={!canSubmit}>
      {submitLabel}
    </Button>
  );
}

export function ReasonForm({
  action,
  reasons,
  reasonName = 'reason',
  reasonLabel = 'Основание',
  requireReason = true,
  danger = false,
  submitLabel = 'Применить',
  confirmLabel = 'Подтвердить',
  reference,
  children,
  error,
  pending = false,
  className,
}: ReasonFormProps) {
  const [reason, setReason] = useState('');
  const [armed, setArmed] = useState(false);

  const canSubmit = !requireReason || reason.trim().length > 0;

  return (
    <form
      action={action as unknown as string}
      className={cn('space-y-4 rounded-lg border border-border bg-elevated p-4', className)}
    >
      {children}

      {reasons && reasons.length > 0 ? (
        <FormField label="Типовая причина" htmlFor={`${reasonName}-preset`}>
          <Select
            id={`${reasonName}-preset`}
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) setReason(e.target.value);
            }}
          >
            <option value="">— выбрать —</option>
            {reasons.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </FormField>
      ) : null}

      <FormField
        label={reasonLabel}
        htmlFor={reasonName}
        required={requireReason}
        hint="Будет записано в неизменяемый журнал (кто/когда/основание)."
      >
        <textarea
          id={reasonName}
          name={reasonName}
          rows={3}
          required={requireReason}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            if (armed) setArmed(false);
          }}
          className={cn(
            'w-full rounded-xl border border-border bg-card px-4 py-2 text-sm text-primary',
            'placeholder:text-secondary/60',
            'transition-colors focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/20',
          )}
          placeholder="Коротко и по существу — что и почему"
        />
      </FormField>

      {reference ? (
        <FormField label={reference.label ?? '№ заявки / инцидента'} htmlFor={reference.name ?? 'reference'}>
          <Input
            id={reference.name ?? 'reference'}
            name={reference.name ?? 'reference'}
            placeholder={reference.placeholder}
          />
        </FormField>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded border border-negative/40 bg-negative/10 px-3 py-2 text-sm text-negative"
        >
          {error}
        </p>
      ) : null}

      <SubmitRow
        danger={danger}
        armed={armed}
        canSubmit={canSubmit}
        pending={pending}
        submitLabel={submitLabel}
        confirmLabel={confirmLabel}
        onArm={() => setArmed(true)}
        onDisarm={() => setArmed(false)}
      />
    </form>
  );
}
