'use client';

import { useEffect, useRef } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Button, FormField, Input, Select } from '@broker/ui';
import { createOperatorAction, type OperatorActionState } from '@/lib/operators/actions';
import { operatorErrorText } from './messages';

/**
 * Форма завода оператора (ADM-04). Создание — «разрешающее» действие: его
 * можно событием, без второго шага подтверждения (асимметрия Р-394). Но
 * основание обязательно (форма-с-основанием): оно уходит в журнал.
 *
 * Личность автора форма НЕ передаёт — её берёт server action из сессии (Р-451).
 * Пароль хешируется argon2id на сервере; новый оператор при первом входе будет
 * принудительно проведён на TOTP-enroll существующим флоу.
 */
export function CreateOperatorForm() {
  const [state, action] = useFormState<OperatorActionState, FormData>(createOperatorAction, {});
  const formRef = useRef<HTMLFormElement>(null);

  // Успех — чистим форму (иначе логин/пароль остались бы в полях).
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  return (
    <form
      ref={formRef}
      action={action}
      className="space-y-4 rounded border border-border bg-elevated p-4"
    >
      {state.error && (
        <p
          role="alert"
          className="rounded border border-negative/40 bg-negative/10 px-3 py-2 text-sm text-negative"
        >
          {operatorErrorText(state.error)}
        </p>
      )}
      {state.ok && (
        <p
          role="status"
          className="rounded border border-positive/40 bg-positive/10 px-3 py-2 text-sm text-positive"
        >
          Оператор заведён. Он пройдёт регистрацию второго фактора при первом входе.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Логин" htmlFor="login" required>
          <Input id="login" name="login" autoComplete="off" required placeholder="например, j.doe" />
        </FormField>
        <FormField label="Имя" htmlFor="displayName" required>
          <Input id="displayName" name="displayName" autoComplete="off" required placeholder="Иван Петров" />
        </FormField>
        <FormField label="Роль" htmlFor="role" required>
          <Select id="role" name="role" defaultValue="operator" required>
            <option value="operator">operator</option>
            <option value="admin">admin</option>
          </Select>
        </FormField>
        <FormField
          label="Начальный пароль"
          htmlFor="password"
          required
          hint="Минимум 12 символов. Оператор сменит его при необходимости."
        >
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
          />
        </FormField>
      </div>

      <FormField label="Основание" htmlFor="reason" required hint="Уходит в журнал (Р-049).">
        <Input id="reason" name="reason" autoComplete="off" required placeholder="Зачем заводим оператора" />
      </FormField>

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} disabled={pending}>
      Завести оператора
    </Button>
  );
}
