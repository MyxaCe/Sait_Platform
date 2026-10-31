'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { Button, FormField, Input } from '@broker/ui';
import { loginAction, type LoginState } from '@/lib/actions';

/**
 * Форма входа оператора — два шага (ADM-01 + ADM-13).
 *
 * Шаг 1: логин+пароль. Если у оператора включена 2FA, сервер возвращает
 * `step: 'totp'`, и форма ДОУЧИВАЕТСЯ до ввода кода (сессия ещё не выдана).
 * Шаг 2: код из приложения-аутентификатора. Личность второго шага сервер
 * держит в httpOnly-куке (CHALLENGE), форма её не носит.
 *
 * Ошибка — ОДНА и общая (Р-451): форма не сообщает ни существует ли логин, ни
 * включена ли 2FA. 'invalidCredentials' покрывает неверный логин/пароль,
 * отключённого оператора, пустые поля и неверный код TOTP — все одинаковы.
 */

const MESSAGES: Record<string, string> = {
  invalidCredentials: 'Неверные данные. Проверьте логин, пароль или код.',
  rateLimited: 'Слишком много попыток. Повторите через минуту.',
};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? '…' : label}
    </Button>
  );
}

export function LoginForm() {
  const [state, formAction] = useFormState<LoginState, FormData>(loginAction, {});
  const totpStep = state.step === 'totp';

  return (
    <form action={formAction} className="flex flex-col gap-4 text-left" noValidate>
      {state.error ? (
        <p role="alert" className="rounded border border-negative/40 bg-negative/10 px-3 py-2 text-sm text-negative">
          {MESSAGES[state.error] ?? 'Войти не удалось.'}
        </p>
      ) : null}

      {totpStep ? (
        <>
          <p className="text-sm text-secondary">
            Введите код из приложения-аутентификатора.
          </p>
          <FormField label="Код подтверждения" htmlFor="code" required>
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
          <SubmitButton label="Подтвердить" />
        </>
      ) : (
        <>
          <FormField label="Логин" htmlFor="login" required>
            <Input id="login" name="login" type="text" autoComplete="username" autoFocus />
          </FormField>

          <FormField label="Пароль" htmlFor="password" required>
            <Input id="password" name="password" type="password" autoComplete="current-password" />
          </FormField>

          <SubmitButton label="Войти" />
        </>
      )}
    </form>
  );
}
