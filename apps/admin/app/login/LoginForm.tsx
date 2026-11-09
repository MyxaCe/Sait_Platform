'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { Button, Callout, Input } from '@broker/ui';
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
    <Button
      type="submit"
      size="compact"
      className="h-10 w-full"
      loading={pending}
      disabled={pending}
    >
      {label}
    </Button>
  );
}

function Steps({ current }: { current: 1 | 2 }) {
  return (
    <ol className="flex items-center gap-2 text-xs" aria-label="Шаги входа">
      {['Пароль', 'Код 2FA'].map((label, i) => {
        const n = (i + 1) as 1 | 2;
        const done = n < current;
        const active = n === current;
        return (
          <li key={label} className="flex items-center gap-2">
            {i > 0 ? <span aria-hidden className="bg-border-strong h-px w-6" /> : null}
            <span
              aria-current={active ? 'step' : undefined}
              className={
                active
                  ? 'text-primary flex items-center gap-1.5 font-medium'
                  : 'text-muted flex items-center gap-1.5'
              }
            >
              <span
                className={
                  active
                    ? 'bg-accent text-on-accent flex size-5 items-center justify-center rounded-full text-[11px] font-semibold'
                    : done
                      ? 'bg-positive/15 text-positive flex size-5 items-center justify-center rounded-full text-[11px] font-semibold'
                      : 'border-border-strong flex size-5 items-center justify-center rounded-full border text-[11px]'
                }
              >
                {done ? '✓' : n}
              </span>
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const fieldLabel = 'text-secondary text-xs font-medium';

export function LoginForm() {
  const [state, formAction] = useFormState<LoginState, FormData>(loginAction, {});
  const totpStep = state.step === 'totp';

  return (
    <div className="space-y-6">
      <Steps current={totpStep ? 2 : 1} />
      <form action={formAction} className="flex flex-col gap-4 text-left" noValidate>
        {state.error ? (
          <Callout tone="negative">{MESSAGES[state.error] ?? 'Войти не удалось.'}</Callout>
        ) : null}

        {totpStep ? (
          <>
            <p className="text-secondary text-sm">
              Откройте приложение-аутентификатор и введите шестизначный код для Wholesalefy.
            </p>
            <label className="flex flex-col gap-1.5">
              <span className={fieldLabel}>Код подтверждения</span>
              <Input
                id="code"
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                autoFocus
                controlSize="compact"
                placeholder="000 000"
                className="h-11 text-center font-mono text-lg tracking-[0.4em]"
              />
            </label>
            <SubmitButton label="Подтвердить и войти" />
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1.5">
              <span className={fieldLabel}>Логин</span>
              <Input
                id="login"
                name="login"
                type="text"
                autoComplete="username"
                autoFocus
                controlSize="compact"
                className="h-10"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className={fieldLabel}>Пароль</span>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                controlSize="compact"
                className="h-10"
              />
            </label>

            <SubmitButton label="Продолжить" />
          </>
        )}
      </form>
      <p className="text-muted border-border border-t pt-4 text-xs">
        Нет доступа или потеряли телефон с аутентификатором — обратитесь к администратору
        платформы.
      </p>
    </div>
  );
}
