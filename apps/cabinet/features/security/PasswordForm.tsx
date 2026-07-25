'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Button, FormField, Input } from '@broker/ui';
import { changePasswordAction, type ActionState } from '@/lib/actions';
import { FormMessage, useFieldError } from '@/features/auth/FormMessage';

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? '…' : label}
    </Button>
  );
}

export function PasswordForm() {
  const t = useTranslations('security');
  const tCommon = useTranslations('common');
  const fieldError = useFieldError();
  const [state, formAction] = useFormState<ActionState, FormData>(changePasswordAction, {});

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormMessage error={state.error} />
      {state.ok && (
        <p className="rounded-xl border border-positive/40 bg-positive/10 px-4 py-3 text-sm text-positive">
          {t('passwordChanged')}
        </p>
      )}

      <FormField label={t('currentPassword')} htmlFor="currentPassword" required error={fieldError(state.fieldErrors?.currentPassword)}>
        <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" invalid={!!state.fieldErrors?.currentPassword} />
      </FormField>
      <FormField label={t('newPassword')} htmlFor="newPassword" required error={fieldError(state.fieldErrors?.newPassword)}>
        <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" invalid={!!state.fieldErrors?.newPassword} />
      </FormField>
      <FormField label={t('confirmPassword')} htmlFor="confirmPassword" required error={fieldError(state.fieldErrors?.confirmPassword)}>
        <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" invalid={!!state.fieldErrors?.confirmPassword} />
      </FormField>

      <div>
        <SubmitButton label={tCommon('save')} />
      </div>
    </form>
  );
}
