'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Button, FormField, Input, Select } from '@broker/ui';
import { updateProfileAction, type ActionState } from '@/lib/actions';
import { FormMessage, useFieldError } from '@/features/auth/FormMessage';

function SubmitButton({ label, savedLabel, saved }: { label: string; savedLabel: string; saved: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? '…' : saved ? savedLabel : label}
    </Button>
  );
}

export function ProfileForm({
  fullName,
  email,
  locale,
}: {
  fullName: string;
  email: string;
  locale: 'ru' | 'en';
}) {
  const t = useTranslations('profile');
  const tCommon = useTranslations('common');
  const fieldError = useFieldError();
  const [state, formAction] = useFormState<ActionState, FormData>(updateProfileAction, {});
  const saved = state.ok === true;

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormMessage error={state.error} />

      <FormField label={t('fullName')} htmlFor="fullName" required error={fieldError(state.fieldErrors?.fullName)}>
        <Input id="fullName" name="fullName" defaultValue={fullName} invalid={!!state.fieldErrors?.fullName} />
      </FormField>

      <FormField label={t('email')} htmlFor="email" hint={t('emailHint')}>
        <Input id="email" name="emailDisplay" defaultValue={email} disabled />
      </FormField>

      <FormField label={t('language')} htmlFor="locale">
        <Select id="locale" name="locale" defaultValue={locale}>
          <option value="ru">Русский</option>
          <option value="en">English</option>
        </Select>
      </FormField>

      <div>
        <SubmitButton label={tCommon('save')} savedLabel={tCommon('saved')} saved={saved} />
      </div>
    </form>
  );
}
