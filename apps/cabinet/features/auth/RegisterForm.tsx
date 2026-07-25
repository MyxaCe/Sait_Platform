'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useLocale, useTranslations } from 'next-intl';
import { Button, FormField, Input, Select } from '@broker/ui';
import { registerAction, type ActionState } from '@/lib/actions';
import { FormMessage, useFieldError } from './FormMessage';

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? '…' : label}
    </Button>
  );
}

export function RegisterForm() {
  const t = useTranslations('auth');
  const locale = useLocale();
  const fieldError = useFieldError();
  const [state, formAction] = useFormState<ActionState, FormData>(registerAction, {});

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormMessage error={state.error} />
      <input type="hidden" name="locale" value={locale} />
      {/* honeypot */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label={t('firstName')} htmlFor="firstName" required error={fieldError(state.fieldErrors?.firstName)}>
          <Input id="firstName" name="firstName" autoComplete="given-name" invalid={!!state.fieldErrors?.firstName} />
        </FormField>
        <FormField label={t('lastName')} htmlFor="lastName" required error={fieldError(state.fieldErrors?.lastName)}>
          <Input id="lastName" name="lastName" autoComplete="family-name" invalid={!!state.fieldErrors?.lastName} />
        </FormField>
      </div>

      <FormField label={t('email')} htmlFor="email" required error={fieldError(state.fieldErrors?.email)}>
        <Input id="email" name="email" type="email" autoComplete="email" invalid={!!state.fieldErrors?.email} />
      </FormField>

      <FormField label={t('phone')} htmlFor="phone" required error={fieldError(state.fieldErrors?.phone)}>
        <Input id="phone" name="phone" type="tel" autoComplete="tel" placeholder="+357 25 000 000" invalid={!!state.fieldErrors?.phone} />
      </FormField>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label={t('country')} htmlFor="country" required error={fieldError(state.fieldErrors?.country)}>
          <Input id="country" name="country" autoComplete="country-name" invalid={!!state.fieldErrors?.country} />
        </FormField>
        <FormField label={t('accountType')} htmlFor="accountType" required>
          <Select id="accountType" name="accountType" defaultValue="standard">
            <option value="standard">{t('accountTypes.standard')}</option>
            <option value="pro">{t('accountTypes.pro')}</option>
            <option value="ecn">{t('accountTypes.ecn')}</option>
          </Select>
        </FormField>
      </div>

      <FormField label={t('password')} htmlFor="password" required error={fieldError(state.fieldErrors?.password)}>
        <Input id="password" name="password" type="password" autoComplete="new-password" invalid={!!state.fieldErrors?.password} />
      </FormField>

      <SubmitButton label={t('registerButton')} />
      <p className="text-center text-xs text-secondary/80">{t('riskNote')}</p>
    </form>
  );
}
