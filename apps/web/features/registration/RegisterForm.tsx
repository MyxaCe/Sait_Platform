'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from '@/i18n/navigation';
import { Button, Checkbox, FormField, Input, Select, cn } from '@broker/ui';
import {
  ACCOUNT_TYPE_VALUES,
  registerLeadSchema,
  type RegisterLeadInput,
} from './schema';

interface ApiFieldErrors {
  fieldErrors?: Partial<Record<keyof RegisterLeadInput, string>>;
  error?: string;
}

interface CountryOption {
  code: string;
  label: string;
}

async function submitLead(data: RegisterLeadInput & { locale: string }) {
  const res = await fetch('/api/leads/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = (await res.json().catch(() => ({}))) as ApiFieldErrors & { leadId?: string };
  if (!res.ok) throw Object.assign(new Error(json.error ?? 'generic'), json);
  return json;
}

export function RegisterForm() {
  const t = useTranslations('registerForm');
  const tv = useTranslations('validation');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const countries = t.raw('countries') as CountryOption[];

  // Ошибки валидации приходят КЛЮЧАМИ (см. schema.ts) — переводим при показе
  const msg = (key?: string) => (key ? (tv.has(key as never) ? tv(key as never) : key) : undefined);

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<RegisterLeadInput>({
    resolver: zodResolver(registerLeadSchema),
    mode: 'onTouched',
    defaultValues: { accountType: 'standard', country: '' },
  });

  // Предвыбор тарифа из /register?account=pro (ссылки со страницы тарифов)
  useEffect(() => {
    const account = new URLSearchParams(window.location.search).get('account');
    if (account && (ACCOUNT_TYPE_VALUES as readonly string[]).includes(account)) {
      setValue('accountType', account as RegisterLeadInput['accountType']);
    }
  }, [setValue]);

  const mutation = useMutation({
    mutationFn: submitLead,
    onError: (err) => {
      const fieldErrors = (err as ApiFieldErrors).fieldErrors;
      if (fieldErrors) {
        for (const [field, message] of Object.entries(fieldErrors)) {
          if (message) setError(field as keyof RegisterLeadInput, { message });
        }
      }
    },
  });

  if (mutation.isSuccess) {
    return (
      <div className="rounded-3xl border border-positive/40 bg-positive/5 p-8 text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-positive/15">
          <svg viewBox="0 0 24 24" className="size-7 fill-none stroke-positive" aria-hidden>
            <path d="M5 13l4 4L19 7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 className="mt-5 text-xl font-semibold text-primary">{t('successTitle')}</h2>
        <p className="mt-2 text-sm leading-relaxed text-secondary">
          {t.rich('successText', {
            email: getValues('email'),
          })}
        </p>
        <Link href="/" className="mt-6 inline-block">
          <Button variant="secondary" tabIndex={-1}>
            {tCommon('backHome')}
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit((data) => mutation.mutate({ ...data, locale }))}
      noValidate
      className="space-y-5"
    >
      {/* Honeypot: невидимое поле-ловушка для ботов */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
        className="absolute -left-[9999px] h-0 w-0 opacity-0"
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label={t('firstName')} htmlFor="reg-firstName" required error={msg(errors.firstName?.message)}>
          <Input
            id="reg-firstName"
            autoComplete="given-name"
            invalid={!!errors.firstName}
            {...register('firstName')}
          />
        </FormField>
        <FormField label={t('lastName')} htmlFor="reg-lastName" required error={msg(errors.lastName?.message)}>
          <Input
            id="reg-lastName"
            autoComplete="family-name"
            invalid={!!errors.lastName}
            {...register('lastName')}
          />
        </FormField>
      </div>

      <FormField label={t('email')} htmlFor="reg-email" required error={msg(errors.email?.message)}>
        <Input
          id="reg-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          invalid={!!errors.email}
          {...register('email')}
        />
      </FormField>

      <FormField
        label={t('phone')}
        htmlFor="reg-phone"
        required
        error={msg(errors.phone?.message)}
        hint={t('phoneHint')}
      >
        <Input
          id="reg-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+7 900 123-45-67"
          invalid={!!errors.phone}
          {...register('phone')}
        />
      </FormField>

      <FormField label={t('country')} htmlFor="reg-country" required error={msg(errors.country?.message)}>
        <Select id="reg-country" invalid={!!errors.country} {...register('country')}>
          <option value="" disabled>
            {t('countryPlaceholder')}
          </option>
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </Select>
      </FormField>

      {/* Тип счёта — радио-карточки */}
      <fieldset>
        <legend className="mb-2 text-sm text-secondary">
          {t('accountType')}
          <span aria-hidden className="ml-0.5 text-negative">*</span>
        </legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {ACCOUNT_TYPE_VALUES.map((value) => (
            <label
              key={value}
              className={cn(
                'cursor-pointer rounded-xl border p-3.5 transition-colors',
                'has-[:checked]:border-accent has-[:checked]:bg-accent/10',
                'border-border bg-card hover:border-accent/40',
              )}
            >
              <input type="radio" value={value} className="sr-only" {...register('accountType')} />
              <span className="block text-sm font-semibold text-primary">
                {value === 'standard' ? 'Standard' : value === 'pro' ? 'Pro' : 'ECN Prime'}
              </span>
              <span className="mt-0.5 block text-xs text-secondary">
                {t(`accountHints.${value}`)}
              </span>
            </label>
          ))}
        </div>
        {errors.accountType && (
          <p role="alert" className="mt-1.5 text-xs text-negative">
            {msg(errors.accountType.message)}
          </p>
        )}
      </fieldset>

      <div>
        <label className="flex cursor-pointer items-start gap-3">
          <Checkbox {...register('agreeTerms')} className="mt-0.5" />
          <span className="text-sm leading-relaxed text-secondary">
            {t.rich('agree', {
              terms: (chunks) => (
                <Link href="/legal/terms" className="text-accent hover:underline">
                  {chunks}
                </Link>
              ),
              risk: (chunks) => (
                <Link href="/legal/risk-disclosure" className="text-accent hover:underline">
                  {chunks}
                </Link>
              ),
            })}
          </span>
        </label>
        {errors.agreeTerms && (
          <p role="alert" className="mt-1.5 text-xs text-negative">
            {msg(errors.agreeTerms.message)}
          </p>
        )}
      </div>

      {mutation.isError && !(mutation.error as ApiFieldErrors).fieldErrors && (
        <p role="alert" className="rounded-xl bg-negative/10 px-4 py-3 text-sm text-negative">
          {msg((mutation.error as Error).message) ?? tv('generic')}
        </p>
      )}

      <Button type="submit" size="lg" className="w-full" loading={mutation.isPending}>
        {t('submit')}
      </Button>

      <p className="text-center text-xs text-secondary">
        {t('haveAccount')}{' '}
        <Link href="/login" className="text-accent hover:underline">
          {tCommon('login')}
        </Link>
      </p>
    </form>
  );
}
