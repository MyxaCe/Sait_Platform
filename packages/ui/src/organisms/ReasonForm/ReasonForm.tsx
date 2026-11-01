'use client';

import { useState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '../../atoms/Button/Button';
import { Input } from '../../atoms/Input/Input';
import { Select } from '../../atoms/Select/Select';
import { FormField } from '../../molecules/FormField/FormField';
import { cn } from '../../lib/cn';

/**
 * `ReasonForm` — форма-с-основанием (§5.3 п.3, §5.4). UI-воплощение инварианта
 * «кто/когда/основание»: ни одно state-changing действие не уходит без
 * заполненного основания. Поле «Основание» обязательно (select типовых причин +
 * свободный текст); submit заблокирован, пока оно пусто. `danger`-вариант
 * (блокировка, портфель плеча, break-glass) требует второго клика-подтверждения.
 *
 * Личность оператора форма НЕ несёт — её берёт server action из сессии (Р-451).
 * В форму кладётся только `reason` (+ опц. номер заявки/инцидента и доп. поля
 * через `children`, напр. скрытый `subjectId`).
 */
export interface ReasonFormProps {
  /** Server action, принимающий FormData (reason + children-поля). */
  action: (formData: FormData) => void | Promise<void>;
  /** Типовые причины для быстрого выбора; свободный текст доступен всегда. */
  reasons?: string[];
  reasonName?: string;
  reasonLabel?: string;
  /** По умолчанию `true`: пустое основание блокирует submit. */
  requireReason?: boolean;
  /** Опасное действие: красная кнопка + подтверждение в два шага. */
  danger?: boolean;
  submitLabel?: string;
  confirmLabel?: string;
  /** Опциональное поле «№ заявки/инцидента». */
  reference?: { name?: string; label?: string; placeholder?: string };
  /** Доп. поля формы (скрытые subjectId/сумма/тип и пр.). */
  children?: ReactNode;
  /** Текст ошибки от server action (уже локализованный). */
  error?: string;
  className?: string;
}

interface SubmitProps {
  danger: boolean;
  armed: boolean;
  canSubmit: boolean;
  submitLabel: string;
  confirmLabel: string;
  onArm: () => void;
  onDisarm: () => void;
}

/** Кнопка submit: знает про pending (useFormStatus) и про danger-двухшаг. */
function SubmitRow({
  danger,
  armed,
  canSubmit,
  submitLabel,
  confirmLabel,
  onArm,
  onDisarm,
}: SubmitProps) {
  const { pending } = useFormStatus();

  if (danger && !armed) {
    // Первый клик — только взвод, не отправка (type=button).
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
  className,
}: ReasonFormProps) {
  const [reason, setReason] = useState('');
  const [armed, setArmed] = useState(false);

  const canSubmit = !requireReason || reason.trim().length > 0;

  return (
    <form
      action={action}
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
            if (armed) setArmed(false); // правка основания снимает взвод
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
        submitLabel={submitLabel}
        confirmLabel={confirmLabel}
        onArm={() => setArmed(true)}
        onDisarm={() => setArmed(false)}
      />
    </form>
  );
}
