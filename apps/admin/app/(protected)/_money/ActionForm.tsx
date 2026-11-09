'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Button, Callout, Textarea, cn } from '@broker/ui';
import type { MoneyActionState } from '@/lib/crypto/actions';
import { moneyErrorText } from '@/lib/crypto/labels';

/**
 * Форма-с-основанием денежной зоны (концепция §6.6–6.7): обязательное
 * «Основание» (пишется в журнал), submit заблокирован без него. Опасное и
 * денежное — в два шага: первый клик «взводит», под формой появляется сводка
 * (сумма, адрес, клиент — крупно) и последствия, второй — подтверждает.
 * Правка основания или полей действия снимает взвод. Личность оператора
 * форма не несёт (из сессии, Р-451). Поля действия — `children`.
 *
 * Фаза 2 поменяла ТОЛЬКО вид и шаг подтверждения: server action, имена полей
 * (`reason` + поля из `children`) и порядок отправки — прежние.
 */

/* ─── Итог действия над формами (панель решения) ────────────────────── */

/**
 * После успешного решения по заявке её статус меняется, и форма, принявшая
 * решение, исчезает из панели вместе со своим Callout. Чтобы оператор всё же
 * увидел, что записано, панель решения оборачивает формы в `DecisionArea` —
 * итог показывается над ними и живёт, пока открыта та же заявка (панель
 * перемонтируется по ключу заявки).
 */
const DecisionReport = createContext<((text: string) => void) | null>(null);

export function DecisionArea({ children }: { children: ReactNode }) {
  const [done, setDone] = useState<string | null>(null);
  return (
    <DecisionReport.Provider value={setDone}>
      <div className="space-y-4">
        {done ? <Callout tone="positive">{done} Запись в журнале.</Callout> : null}
        {children}
      </div>
    </DecisionReport.Provider>
  );
}

/* ─── Подтверждение ─────────────────────────────────────────────────── */

export interface ConfirmSpec {
  /** Вопрос подтверждения: «Одобрить вывод?» */
  title: ReactNode;
  /** Сводка «что именно» — сумма, адрес, клиент крупно (`ConfirmFacts`). */
  summary?: ReactNode;
  /** Что произойдёт после подтверждения. */
  consequence: ReactNode;
  /** Подпись кнопки подтверждения («Да, одобрить вывод»). */
  confirmLabel?: string;
  /** `danger` — отказ/возврат/отмена; `primary` — денежное, но не отказ. */
  tone: 'danger' | 'primary';
}

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
  confirm,
  disarmOn,
  reasonLabel = 'Основание',
  reasonHint = 'Обязательно. Пишется в неизменяемый журнал вместе с вашим логином.',
  reasonPlaceholder = 'Почему принимается это решение',
  extraValid = true,
  className,
}: {
  action: (state: MoneyActionState, fd: FormData) => Promise<MoneyActionState>;
  submitLabel: string;
  okText: string;
  children?: ReactNode;
  variant?: 'primary' | 'secondary' | 'danger';
  /** Опасное действие: двухшаговое, красное подтверждение. */
  danger?: boolean;
  /** Сводка и последствия на шаге подтверждения (делает форму двухшаговой). */
  confirm?: ConfirmSpec;
  /** Изменилось значение (напр. хэш, клиент) — взвод снимается. */
  disarmOn?: unknown;
  reasonLabel?: string;
  reasonHint?: string;
  reasonPlaceholder?: string;
  /** Доп. условие активности submit (напр. заполнен хэш). */
  extraValid?: boolean;
  className?: string;
}) {
  const report = useContext(DecisionReport);
  const reportRef = useRef(report);
  reportRef.current = report;
  const reported = useCallback(
    async (prev: MoneyActionState, fd: FormData) => {
      const r = await action(prev, fd);
      if (r.ok) reportRef.current?.(okText);
      return r;
    },
    [action, okText],
  );
  const [state, formAction] = useFormState<MoneyActionState, FormData>(
    report ? reported : action,
    {},
  );
  const [reason, setReason] = useState('');
  const [armed, setArmed] = useState(false);
  const reasonId = useId();
  const valid = reason.trim().length > 0 && extraValid;

  const twoStep = danger || confirm !== undefined;
  const tone: 'danger' | 'primary' = confirm?.tone ?? (danger ? 'danger' : 'primary');

  // Поля действия изменились — подтверждённая сводка устарела.
  useEffect(() => setArmed(false), [disarmOn]);
  // Успех — форма в исходное состояние (защита от повторной отправки);
  // ошибка — взвод снимается, повтор снова идёт через сводку.
  useEffect(() => {
    if (state.ok) {
      setArmed(false);
      setReason('');
    } else if (state.error) {
      setArmed(false);
    }
  }, [state]);

  return (
    <form action={formAction} className={cn('space-y-3', className)}>
      {state.error ? (
        <Callout tone="negative">{moneyErrorText(state.error, state.detail)}</Callout>
      ) : state.ok && !report ? (
        <Callout tone="positive">{okText}</Callout>
      ) : null}
      {children}
      <div className="space-y-1.5">
        <label htmlFor={reasonId} className="text-muted block text-xs">
          {reasonLabel}
        </label>
        <Textarea
          id={reasonId}
          name="reason"
          rows={2}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setArmed(false);
          }}
          placeholder={reasonPlaceholder}
          aria-describedby={`${reasonId}-hint`}
        />
        <p id={`${reasonId}-hint`} className="text-muted text-xs">
          {reasonHint}
        </p>
      </div>

      {twoStep && armed ? (
        <div
          role="group"
          aria-label="Подтверждение действия"
          className={cn(
            'space-y-3 rounded-md border p-3',
            tone === 'danger'
              ? 'border-negative/40 bg-negative/[0.06]'
              : 'border-border-strong bg-sunken',
          )}
        >
          <p
            className={cn(
              'text-sm font-semibold',
              tone === 'danger' ? 'text-negative' : 'text-primary',
            )}
          >
            {confirm?.title ?? `Подтвердите: ${submitLabel.toLowerCase()}?`}
          </p>
          {confirm?.summary}
          {confirm?.consequence ? (
            <p className={cn('text-[13px]', tone === 'danger' ? 'text-negative' : 'text-secondary')}>
              {confirm.consequence}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Submit
              label={confirm?.confirmLabel ?? `Да, ${submitLabel.toLowerCase()}`}
              variant={tone === 'danger' ? 'danger' : 'primary'}
              disabled={!valid}
            />
            <Button
              type="button"
              size="compact"
              variant="secondary"
              onClick={() => setArmed(false)}
            >
              Отмена
            </Button>
          </div>
        </div>
      ) : twoStep ? (
        <Button
          type="button"
          size="compact"
          variant={tone === 'danger' ? 'danger-outline' : variant}
          disabled={!valid}
          onClick={() => setArmed(true)}
        >
          {submitLabel}
        </Button>
      ) : (
        <Submit label={submitLabel} variant={variant} disabled={!valid} />
      )}
    </form>
  );
}

/* ─── Сводка для подтверждения ──────────────────────────────────────── */

/**
 * «Что именно» — крупно, чтобы оператор сверил глазами перед вторым кликом:
 * сумма, адрес, клиент. Строки — `[подпись, значение]`; `false`/`null`
 * пропускаются.
 */
export function ConfirmFacts({ rows }: { rows: Array<[string, ReactNode] | null | false> }) {
  const items = rows.filter((r): r is [string, ReactNode] => Boolean(r));
  return (
    <dl className="space-y-2.5">
      {items.map(([term, value]) => (
        <div key={term} className="min-w-0">
          <dt className="text-muted text-xs">{term}</dt>
          <dd className="text-primary mt-0.5 min-w-0 text-[15px] font-medium leading-snug">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
