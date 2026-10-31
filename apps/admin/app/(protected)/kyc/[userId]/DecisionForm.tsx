'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@broker/ui';
import {
  rejectClientAction,
  verifyClientAction,
  type DecisionState,
} from '@/lib/kyc/actions';

/**
 * Форма решения по KYC (ADM-08). Два server action-а: подтвердить (без
 * причины) и отклонить (причина обязательна — клиент должен знать, что
 * исправить). Личность оператора форма НЕ передаёт: её берёт action из сессии
 * (Р-451). В форме — только `userId` (о ком решение) и `reason` (основание).
 */

const MESSAGES: Record<string, string> = {
  invalidClient: 'Клиент не указан.',
  missingReason: 'Для отклонения нужна причина.',
  notPending: 'Клиент уже не в состоянии ожидания — возможно, решение уже принято.',
};

function Error({ state }: { state: DecisionState }) {
  if (!state.error) return null;
  return (
    <p
      role="alert"
      className="rounded border border-negative/40 bg-negative/10 px-3 py-2 text-sm text-negative"
    >
      {MESSAGES[state.error] ?? 'Решение не применено.'}
    </p>
  );
}

function VerifyButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? '…' : 'Подтвердить'}
    </Button>
  );
}

function RejectButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="danger" disabled={pending}>
      {pending ? '…' : 'Отклонить с причиной'}
    </Button>
  );
}

export function DecisionForm({ userId }: { userId: string }) {
  const [verifyState, verifyAction] = useFormState<DecisionState, FormData>(verifyClientAction, {});
  const [rejectState, rejectAction] = useFormState<DecisionState, FormData>(rejectClientAction, {});

  return (
    <div className="space-y-4 rounded border border-border bg-elevated p-4">
      <Error state={verifyState} />
      <Error state={rejectState} />

      <form action={verifyAction}>
        <input type="hidden" name="userId" value={userId} />
        <VerifyButton />
      </form>

      <form action={rejectAction} className="space-y-2 border-t border-border pt-4">
        <input type="hidden" name="userId" value={userId} />
        <label htmlFor="reason" className="block text-sm text-secondary">
          Причина отклонения
        </label>
        <textarea
          id="reason"
          name="reason"
          rows={3}
          className="w-full rounded border border-border bg-base px-3 py-2 text-sm text-primary outline-none focus:border-accent"
          placeholder="Что именно не так с документами клиента"
        />
        <RejectButton />
      </form>
    </div>
  );
}
