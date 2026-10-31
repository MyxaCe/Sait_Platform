'use client';

import { useEffect, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Button, FormField, Input } from '@broker/ui';
import {
  beginTotpEnrollment,
  confirmTotpEnrollment,
  type EnrollConfirmState,
  type EnrollStartResult,
} from '@/lib/totp/actions';

/**
 * Клиентская форма регистрации TOTP. На монтировании просит сервер завести
 * секрет (`beginTotpEnrollment`) — секрет живёт в httpOnly-тикете, сюда
 * приходят только provisioning-URI и ручной ключ для сканирования. Затем
 * оператор вводит код; `confirmTotpEnrollment` сверяет его и при успехе
 * сохраняет секрет и уводит внутрь (redirect из action).
 */

const MESSAGES: Record<string, string> = {
  invalidCode: 'Код не подошёл. Проверьте время на устройстве и попробуйте снова.',
  expired: 'Время настройки истекло. Обновите страницу и начните заново.',
  alreadyEnrolled: 'Второй фактор уже настроен.',
};

function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? '…' : 'Подтвердить и включить'}
    </Button>
  );
}

export function EnrollForm() {
  const [provision, setProvision] = useState<EnrollStartResult | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [state, formAction] = useFormState<EnrollConfirmState, FormData>(confirmTotpEnrollment, {});

  useEffect(() => {
    let active = true;
    beginTotpEnrollment()
      .then((result) => {
        if (!active) return;
        if ('error' in result) setStartError(result.error);
        else setProvision(result);
      })
      .catch(() => active && setStartError('expired'));
    return () => {
      active = false;
    };
  }, []);

  if (startError) {
    return (
      <p role="alert" className="rounded border border-negative/40 bg-negative/10 px-3 py-2 text-sm text-negative">
        {MESSAGES[startError] ?? 'Не удалось начать настройку.'}
      </p>
    );
  }

  if (!provision) {
    return <p className="text-center text-sm text-secondary">Готовим секрет…</p>;
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2 rounded border border-border bg-elevated p-4">
        <p className="text-sm text-secondary">
          Отсканируйте QR или добавьте вручную по ключу ниже. Строка для QR
          (otpauth://):
        </p>
        <code className="block overflow-x-auto whitespace-nowrap rounded bg-base px-3 py-2 text-xs text-primary">
          {provision.uri}
        </code>
        <p className="text-sm text-secondary">Ручной ключ:</p>
        <code className="block select-all rounded bg-base px-3 py-2 font-mono text-sm tracking-wider text-primary">
          {provision.secret}
        </code>
      </div>

      <form action={formAction} className="flex flex-col gap-4 text-left" noValidate>
        {state.error ? (
          <p role="alert" className="rounded border border-negative/40 bg-negative/10 px-3 py-2 text-sm text-negative">
            {MESSAGES[state.error] ?? 'Не удалось включить второй фактор.'}
          </p>
        ) : null}

        <FormField label="Код из приложения" htmlFor="code" required>
          <Input
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            autoFocus
          />
        </FormField>

        <ConfirmButton />
      </form>
    </div>
  );
}
