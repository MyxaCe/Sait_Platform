'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormState } from 'react-dom';
import { Callout, Input, Select } from '@broker/ui';
import { createOperatorAction, type OperatorActionState } from '@/lib/operators/actions';
import type { OperatorRole } from '@/lib/auth/session';
import { Field, ReasonField, SubmitButton } from '@/components/control/forms';
import { operatorErrorText } from './messages';
import { ROLES, ROLE_LABEL, ROLE_SCOPE } from './roles';

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
  const [role, setRole] = useState<OperatorRole>('operator');
  const [reason, setReason] = useState('');

  // Успех — чистим форму (иначе логин/пароль остались бы в полях).
  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setReason('');
      setRole('operator');
    }
  }, [state.ok]);

  return (
    <form ref={formRef} action={action} className="space-y-4">
      {state.error ? <Callout tone="negative">{operatorErrorText(state.error)}</Callout> : null}
      {state.ok ? (
        <Callout tone="positive" title="Оператор заведён, запись в журнале">
          При первом входе он обязательно настроит второй фактор.
        </Callout>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Логин" htmlFor="login">
          <Input
            id="login"
            name="login"
            controlSize="compact"
            autoComplete="off"
            required
            placeholder="j.doe"
          />
        </Field>
        <Field label="Имя" htmlFor="displayName">
          <Input
            id="displayName"
            name="displayName"
            controlSize="compact"
            autoComplete="off"
            required
            placeholder="Иван Петров"
          />
        </Field>
      </div>

      <Field label="Роль" htmlFor="role" hint={ROLE_SCOPE[role]}>
        <Select
          id="role"
          name="role"
          controlSize="compact"
          value={role}
          onChange={(e) => setRole(e.target.value as OperatorRole)}
          required
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Начальный пароль"
        htmlFor="password"
        hint="Не короче 12 символов. Передайте оператору защищённым каналом."
      >
        <Input
          id="password"
          name="password"
          type="password"
          controlSize="compact"
          autoComplete="new-password"
          minLength={12}
          required
        />
      </Field>

      <ReasonField
        id="create-reason"
        value={reason}
        onChange={setReason}
        placeholder="Зачем заводим оператора (обязательно)"
      />

      <SubmitButton disabled={reason.trim().length === 0}>Завести оператора</SubmitButton>
    </form>
  );
}
