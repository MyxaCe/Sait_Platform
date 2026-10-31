'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { Button, FormField, Input } from '@broker/ui';
import { loginAction, type LoginState } from '@/lib/actions';

/**
 * Форма входа оператора. Клиентский компонент: сабмит идёт server action-ом
 * `loginAction` (POST в этот же роут `/login`), без отдельной `/api`-ручки.
 *
 * Ошибка — ОДНА и общая (Р-451): форма не сообщает, существует ли логин.
 * 'invalidCredentials' покрывает и неверный логин/пароль, и отключённого
 * оператора, и пустые поля — все они выглядят одинаково.
 */

const MESSAGES: Record<string, string> = {
  invalidCredentials: 'Неверный логин или пароль.',
  rateLimited: 'Слишком много попыток. Повторите через минуту.',
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? '…' : 'Войти'}
    </Button>
  );
}

export function LoginForm() {
  const [state, formAction] = useFormState<LoginState, FormData>(loginAction, {});

  return (
    <form action={formAction} className="flex flex-col gap-4 text-left" noValidate>
      {state.error ? (
        <p role="alert" className="rounded border border-negative/40 bg-negative/10 px-3 py-2 text-sm text-negative">
          {MESSAGES[state.error] ?? 'Войти не удалось.'}
        </p>
      ) : null}

      <FormField label="Логин" htmlFor="login" required>
        <Input id="login" name="login" type="text" autoComplete="username" autoFocus />
      </FormField>

      <FormField label="Пароль" htmlFor="password" required>
        <Input id="password" name="password" type="password" autoComplete="current-password" />
      </FormField>

      <SubmitButton />
    </form>
  );
}
