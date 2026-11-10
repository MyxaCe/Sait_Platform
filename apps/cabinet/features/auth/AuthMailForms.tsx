'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useLocale, useTranslations } from 'next-intl';
import { Button, FormField, Input } from '@broker/ui';
import { Link } from '@/i18n/navigation';
import {
  confirmEmailAction,
  forgotPasswordAction,
  requestEmailVerifyAction,
  resetPasswordAction,
  type AuthMailState,
} from '@/lib/support/auth-actions';
import { FormMessage, useFieldError } from './FormMessage';

/** Формы auth-писем: «забыли пароль», новый пароль по ссылке, подтверждение email. */

function Submit({ label, size = 'lg', full = true }: { label: string; size?: 'lg' | 'md' | 'sm'; full?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size={size} className={full ? 'w-full' : undefined} disabled={pending} loading={pending}>
      {label}
    </Button>
  );
}

function Notice({ tone, children }: { tone: 'positive' | 'info'; children: React.ReactNode }) {
  return (
    <p role="status" className={tone === 'positive' ? 'rounded-xl border border-positive/40 bg-positive/10 px-4 py-3 text-sm' : 'rounded-xl border border-border bg-primary/5 px-4 py-3 text-sm text-secondary'}>
      {children}
    </p>
  );
}

export function ForgotPasswordForm() {
  const t = useTranslations('authMail');
  const ta = useTranslations('auth');
  const fieldError = useFieldError();
  const [state, action] = useFormState<AuthMailState, FormData>(forgotPasswordAction, {});
  if (state.ok) {
    return (
      <div className="space-y-4">
        <Notice tone="positive">{t('forgotSent')}</Notice>
        <p className="text-sm text-secondary">{t('forgotSentHint')}</p>
        <Link href="/login" className="text-sm text-accent hover:underline">
          ← {t('backToLogin')}
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage error={state.error} />
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      <FormField label={ta('email')} htmlFor="email" required error={fieldError(state.fieldErrors?.email)}>
        <Input id="email" name="email" type="email" autoComplete="email" invalid={!!state.fieldErrors?.email} />
      </FormField>
      <Submit label={t('forgotButton')} />
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations('authMail');
  const locale = useLocale();
  const fieldError = useFieldError();
  const [state, action] = useFormState<AuthMailState, FormData>(resetPasswordAction, {});
  const tokenError = state.error === 'invalidToken' || state.error === 'expiredToken' || state.error === 'usedToken';
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {tokenError ? (
        <p role="alert" className="rounded-xl border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">
          {t(`token.${state.error}`)}{' '}
          <Link href="/forgot-password" className="underline">
            {t('requestNew')}
          </Link>
        </p>
      ) : (
        <FormMessage error={state.error} />
      )}
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="uiLocale" value={locale} />
      <FormField label={t('newPassword')} htmlFor="newPassword" required error={fieldError(state.fieldErrors?.newPassword)} hint={t('newPasswordHint')}>
        <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" invalid={!!state.fieldErrors?.newPassword} />
      </FormField>
      <FormField label={t('confirmPassword')} htmlFor="confirmPassword" required error={fieldError(state.fieldErrors?.confirmPassword)}>
        <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" invalid={!!state.fieldErrors?.confirmPassword} />
      </FormField>
      <Submit label={t('resetButton')} />
    </form>
  );
}

export function ConfirmEmailForm({ token }: { token: string }) {
  const t = useTranslations('authMail');
  const [state, action] = useFormState<AuthMailState, FormData>(confirmEmailAction, {});
  if (state.ok) {
    return (
      <div className="space-y-4">
        <Notice tone="positive">{t('verifyDone')}</Notice>
        <Link href="/" className="text-sm text-accent hover:underline">
          {t('toCabinet')} →
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error ? (
        <p role="alert" className="rounded-xl border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">
          {t(`token.${state.error === 'expiredToken' || state.error === 'usedToken' ? state.error : 'invalidToken'}`)}
        </p>
      ) : null}
      <input type="hidden" name="token" value={token} />
      <Submit label={t('verifyButton')} />
    </form>
  );
}

/** Профиль: «email не подтверждён — отправить письмо». */
export function RequestVerifyEmail() {
  const t = useTranslations('authMail');
  const [state, action] = useFormState<AuthMailState>(requestEmailVerifyAction, {});
  if (state.ok) return <Notice tone="positive">{t('verifySent')}</Notice>;
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <Submit label={t('verifySend')} size="sm" full={false} />
      {state.error ? (
        <span role="alert" className="text-sm text-negative">
          {t.has(`verifyErrors.${state.error}`) ? t(`verifyErrors.${state.error}`) : t('verifyErrors.generic')}
        </span>
      ) : null}
    </form>
  );
}
