'use client';

import { useEffect, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { useLocale, useTranslations } from 'next-intl';
import { Button, FormField, Input } from '@broker/ui';
import { loginAction, loginTwoFactorAction, type ActionState } from '@/lib/actions';
import { CodeInput } from '@/features/security/CodeInput';
import { FormMessage, useFieldError } from './FormMessage';

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? '…' : label}
    </Button>
  );
}

function PasswordStep({
  next,
  initialError,
  onTwoFactor,
}: {
  next?: string | null;
  initialError?: string;
  onTwoFactor: () => void;
}) {
  const t = useTranslations('auth');
  const locale = useLocale();
  const fieldError = useFieldError();
  const [state, formAction] = useFormState<ActionState, FormData>(loginAction, { error: initialError });

  useEffect(() => {
    if (state.twoFactor) onTwoFactor();
  }, [state, onTwoFactor]);

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormMessage error={state.error} />
      <input type="hidden" name="uiLocale" value={locale} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
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

function CodeStep({ next, onBack }: { next?: string | null; onBack: (error?: string) => void }) {
  const t = useTranslations('twoFactor');
  const locale = useLocale();
  const [state, formAction] = useFormState<ActionState, FormData>(loginTwoFactorAction, { twoFactor: true });

  useEffect(() => {
    if (!state.twoFactor) onBack(state.error);
  }, [state, onBack]);

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate data-step="two-factor">
      <div>
        <p className="text-[15px] font-semibold">{t('loginTitle')}</p>
        <p className="mt-1 text-sm text-secondary">{t('loginHint')}</p>
      </div>
      <FormMessage error={state.error} />
      <input type="hidden" name="uiLocale" value={locale} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <FormField label={t('codeOrRecovery')} htmlFor="login-2fa-code" required>
        <CodeInput id="login-2fa-code" invalid={!!state.error} autoFocus />
      </FormField>
      <SubmitButton label={t('loginButton')} />
      <button type="button" className="text-sm text-accent hover:underline" onClick={() => onBack()}>
        {t('loginBack')}
      </button>
    </form>
  );
}

export function LoginForm({ next }: { next?: string | null } = {}) {
  const [phase, setPhase] = useState<{ step: 'password' | 'code'; error?: string; round: number }>({
    step: 'password',
    round: 0,
  });

  if (phase.step === 'code') {
    return <CodeStep next={next} onBack={(error) => setPhase((p) => ({ step: 'password', error, round: p.round + 1 }))} />;
  }
  return (
    <PasswordStep
      key={phase.round}
      next={next}
      initialError={phase.error}
      onTwoFactor={() => setPhase((p) => ({ step: 'code', round: p.round }))}
    />
  );
}
