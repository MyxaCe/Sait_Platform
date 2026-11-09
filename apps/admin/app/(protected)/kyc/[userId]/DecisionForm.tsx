'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Button, Callout, Textarea } from '@broker/ui';
import {
  rejectClientAction,
  requestResubmitAction,
  verifyClientAction,
  type DecisionState,
} from '@/lib/kyc/actions';

/**
 * Форма решения по KYC (ADM-08, ADM-10; концепция §6.6, §6.7, §7.4).
 *
 * Одна форма — одно «Основание» на три решения; каждая кнопка отправляет форму
 * в СВОЙ прежний server action (`formAction`): подтвердить, запросить
 * переподачу, отклонить. Логика экшенов не менялась: личность оператора —
 * из сессии, в форме только `userId` и `reason`; успех — redirect на `/kyc`.
 *
 * Основание обязательно для всех трёх в интерфейсе (инвариант §6.6: у каждого
 * изменяющего действия есть основание); сервер для отклонения и переподачи
 * требует его сам, для подтверждения — принимает и пишет в журнал.
 * Отклонение — двухшаговое: спокойная обводка → подтверждение с последствиями.
 */

const MESSAGES: Record<string, string> = {
  invalidClient: 'Клиент не указан.',
  missingReason: 'Укажите основание решения.',
  notPending:
    'Заявка уже не ждёт решения — возможно, его принял другой оператор. Обновите страницу.',
};

function Submit({
  action,
  variant,
  children,
  disabled,
  full = false,
}: {
  action: (formData: FormData) => void;
  variant: 'primary' | 'secondary' | 'danger';
  children: string;
  disabled: boolean;
  full?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      formAction={action}
      size="compact"
      variant={variant}
      loading={pending}
      disabled={pending || disabled}
      className={full ? 'w-full flex-1' : undefined}
    >
      {children}
    </Button>
  );
}

export function DecisionForm({ userId }: { userId: string }) {
  const [verifyState, verifyAction] = useFormState<DecisionState, FormData>(verifyClientAction, {});
  const [rejectState, rejectAction] = useFormState<DecisionState, FormData>(rejectClientAction, {});
  const [resubmitState, resubmitAction] = useFormState<DecisionState, FormData>(
    requestResubmitAction,
    {},
  );
  const [reason, setReason] = useState('');
  const [confirmReject, setConfirmReject] = useState(false);

  const error = verifyState.error ?? resubmitState.error ?? rejectState.error;
  const empty = reason.trim().length === 0;

  return (
    <form action={verifyAction} className="space-y-3">
      {error ? (
        <Callout tone="negative">{MESSAGES[error] ?? 'Решение не применено.'}</Callout>
      ) : null}

      <div className="space-y-1">
        <label htmlFor="kyc-reason" className="text-muted block text-xs">
          Основание решения
        </label>
        <Textarea
          id="kyc-reason"
          name="reason"
          rows={3}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setConfirmReject(false);
          }}
          placeholder="Что проверено и почему такое решение. При переподаче — какой документ дослать."
        />
        <p className="text-muted text-xs">
          Обязательно. Пишется в неизменяемый журнал вместе с решением.
        </p>
      </div>

      {confirmReject ? (
        <div className="border-negative/30 bg-negative/[0.05] space-y-2 rounded-md border p-3">
          <p className="text-negative text-[13px]">
            Отклонить заявку? Верификация клиента перейдёт в «Отклонён»; ввод и вывод, требующие
            KYC, останутся закрыты. Чтобы клиент мог дослать документы без отказа — используйте
            «Запросить переподачу».
          </p>
          <div className="flex flex-wrap gap-2">
            <Submit action={rejectAction} variant="danger" disabled={empty}>
              Да, отклонить
            </Submit>
            <Button
              type="button"
              size="compact"
              variant="secondary"
              onClick={() => setConfirmReject(false)}
            >
              Отмена
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Submit action={verifyAction} variant="primary" disabled={empty} full>
            Подтвердить KYC
          </Submit>
          <div className="flex gap-2">
            <Submit action={resubmitAction} variant="secondary" disabled={empty} full>
              Запросить переподачу
            </Submit>
            <Button
              type="button"
              size="compact"
              variant="danger-outline"
              disabled={empty}
              onClick={() => setConfirmReject(true)}
            >
              Отклонить…
            </Button>
          </div>
        </div>
      )}
      {/* В конце: скрытое поле не должно получать отступ space-y. */}
      <input type="hidden" name="userId" value={userId} />
    </form>
  );
}
