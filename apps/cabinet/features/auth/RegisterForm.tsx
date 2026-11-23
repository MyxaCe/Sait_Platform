'use client';

import type { ReactNode } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { useLocale, useTranslations } from 'next-intl';
import { Button, FormField, Input } from '@broker/ui';
import { registerAction, type ActionState } from '@/lib/actions';
import { FormMessage, useFieldError } from './FormMessage';
import { PlanPicker, type RegisterPlan } from './PlanPicker';

function docLinks(consent: ConsentLinks | undefined) {
  const link = (href: string | undefined) =>
    function DocLink(chunks: ReactNode) {
      return href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className={consentLinkClass}>
          {chunks}
        </a>
      ) : (
        <>{chunks}</>
      );
    };
  return { termsLink: link(consent?.terms), privacyLink: link(consent?.privacy), riskLink: link(consent?.risk) };
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? '…' : label}
    </Button>
  );
}

export interface RegisterPrefill {
  invite: string;
  firstName: string;
  lastName: string;
  email: string;
  country: string;
}

/** Ссылки на юридические документы витрины для галочки согласия. */
export interface ConsentLinks {
  terms: string;
  privacy: string;
  risk: string;
  /** Редакции, показанные клиенту (`slug@updatedAt;…`), — запасной вариант, если CMS не ответит при отправке. */
  shown: string;
}

const consentLinkClass = 'text-accent underline-offset-2 hover:underline';

export function RegisterForm({
  prefill,
  plans = [],
  selectedPlan,
  next,
  consent,
}: {
  prefill?: RegisterPrefill;
  plans?: RegisterPlan[];
  selectedPlan?: string;
  next?: string | null;
  consent?: ConsentLinks;
} = {}) {
  const t = useTranslations('auth');
  const locale = useLocale();
  const fieldError = useFieldError();
  const [state, formAction] = useFormState<ActionState, FormData>(registerAction, {});

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormMessage error={state.error} />
      <input type="hidden" name="locale" value={locale} />
      {prefill ? <input type="hidden" name="invite" value={prefill.invite} /> : null}
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label={t('firstName')} htmlFor="firstName" required error={fieldError(state.fieldErrors?.firstName)}>
          <Input id="firstName" name="firstName" autoComplete="given-name" defaultValue={prefill?.firstName} invalid={!!state.fieldErrors?.firstName} />
        </FormField>
        <FormField label={t('lastName')} htmlFor="lastName" required error={fieldError(state.fieldErrors?.lastName)}>
          <Input id="lastName" name="lastName" autoComplete="family-name" defaultValue={prefill?.lastName} invalid={!!state.fieldErrors?.lastName} />
        </FormField>
      </div>

      <FormField label={t('email')} htmlFor="email" required error={fieldError(state.fieldErrors?.email)}>
        <Input id="email" name="email" type="email" autoComplete="email" defaultValue={prefill?.email} invalid={!!state.fieldErrors?.email} />
      </FormField>

      <FormField label={t('phone')} htmlFor="phone" required error={fieldError(state.fieldErrors?.phone)}>
        <Input id="phone" name="phone" type="tel" autoComplete="tel" placeholder="+357 25 000 000" invalid={!!state.fieldErrors?.phone} />
      </FormField>

      <FormField label={t('country')} htmlFor="country" required error={fieldError(state.fieldErrors?.country)}>
        <Input id="country" name="country" autoComplete="country-name" defaultValue={prefill?.country} invalid={!!state.fieldErrors?.country} />
      </FormField>

      {plans.length > 0 ? <PlanPicker plans={plans} selected={selectedPlan ?? plans[0]!.key} /> : null}

      <FormField label={t('password')} htmlFor="password" required error={fieldError(state.fieldErrors?.password)}>
        <Input id="password" name="password" type="password" autoComplete="new-password" invalid={!!state.fieldErrors?.password} />
      </FormField>

      <div className="flex flex-col gap-1">
        <label htmlFor="consent" className="flex items-start gap-3 text-sm text-secondary">
          <input
            id="consent"
            name="consent"
            type="checkbox"
            required
            aria-invalid={state.fieldErrors?.consent ? true : undefined}
            aria-describedby={state.fieldErrors?.consent ? 'consent-error' : undefined}
            className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
          />
          <span>
            {t.rich('consentLabel', {
              terms: t('consentTerms'),
              privacy: t('consentPrivacy'),
              risk: t('consentRisk'),
              ...docLinks(consent),
            })}
          </span>
        </label>
        {state.fieldErrors?.consent ? (
          <p id="consent-error" role="alert" className="text-xs text-negative">
            {fieldError(state.fieldErrors.consent)}
          </p>
        ) : null}
        {consent?.shown ? <input type="hidden" name="consentShown" value={consent.shown} /> : null}
      </div>

      <SubmitButton label={t('registerButton')} />
    </form>
  );
}
