'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useLocale, useTranslations } from 'next-intl';
import { Button, FormField, Input } from '@broker/ui';
import { loginAction, type ActionState } from '@/lib/actions';
import { FormMessage, useFieldError } from './FormMessage';

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? '…' : label}
    </Button>
  );
}

export function LoginForm() {
  const t = useTranslations('auth');
  const locale = useLocale();
  const fieldError = useFieldError();
  const [state, formAction] = useFormState<ActionState, FormData>(loginAction, {});

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormMessage error={state.error} />
      <input type="hidden" name="uiLocale" value={locale} />
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />

      <FormField label={t('email')} htmlFor="email" required error={fieldError(state.fieldErrors?.email)}>
        <Input id="email" name="email" type="email" autoComplete="email" invalid={!!state.fieldErrors?.email} />
      </FormField>

      <FormField label={t('password')} htmlFor="password" required error={fieldError(state.fieldErrors?.password)}>
        <Input id="password" name="password" type="password" autoComplete="current-password" invalid={!!state.fieldErrors?.password} />
      </FormField>

      <SubmitButton label={t('loginButton')} />
    </form>
  );
}
