'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Button, FormField, Input, Select } from '@broker/ui';
import { isPlatformLocale, LOCALE_AUTONYMS } from '@broker/utils/locales';
import { useSiteLanguages } from '@/i18n/site-languages-context';
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
  locale: string;
}) {
  const t = useTranslations('profile');
  const tCommon = useTranslations('common');
  const fieldError = useFieldError();
  const [state, formAction] = useFormState<ActionState, FormData>(updateProfileAction, {});
  const saved = state.ok === true;
  const { languages } = useSiteLanguages();
  const options = isPlatformLocale(locale) && !languages.includes(locale) ? [...languages, locale] : languages;

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
          {options.map((l) => (
            <option key={l} value={l}>
              {LOCALE_AUTONYMS[l]}
            </option>
          ))}
        </Select>
      </FormField>

      <div>
        <SubmitButton label={tCommon('save')} savedLabel={tCommon('saved')} saved={saved} />
      </div>
    </form>
  );
}
