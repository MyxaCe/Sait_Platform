'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Button, FormField, Input, Select } from '@broker/ui';
import { CONTACT_TOPIC_VALUES, contactSchema, type ContactInput } from './schema';

interface ApiFieldErrors {
  fieldErrors?: Partial<Record<keyof ContactInput, string>>;
  error?: string;
}

interface TopicOption {
  value: string;
  label: string;
}

async function submitContact(data: ContactInput) {
  const res = await fetch('/api/leads/contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = (await res.json().catch(() => ({}))) as ApiFieldErrors;
  if (!res.ok) throw Object.assign(new Error(json.error ?? 'generic'), json);
  return json;
}

export function ContactForm() {
  const t = useTranslations('contacts.form');
  const tv = useTranslations('validation');
  const topics = t.raw('topics') as TopicOption[];

  // Ошибки валидации приходят ключами — переводим при показе
  const msg = (key?: string) => (key ? (tv.has(key as never) ? tv(key as never) : key) : undefined);

  const {
    register,
    handleSubmit,
    setError,
    reset,
    setValue,
    formState: { errors },
  } = useForm<ContactInput>({
    resolver: zodResolver(contactSchema),
    mode: 'onTouched',
    defaultValues: { topic: 'general' },
  });

  // Предвыбор темы из /company/contacts?topic=partnership (ссылка со страницы партнёрки)
  useEffect(() => {
    const topic = new URLSearchParams(window.location.search).get('topic');
    if (topic && (CONTACT_TOPIC_VALUES as readonly string[]).includes(topic)) {
      setValue('topic', topic as ContactInput['topic']);
    }
  }, [setValue]);

  const mutation = useMutation({
    mutationFn: submitContact,
    onError: (err) => {
      const fieldErrors = (err as ApiFieldErrors).fieldErrors;
      if (fieldErrors) {
        for (const [field, message] of Object.entries(fieldErrors)) {
          if (message) setError(field as keyof ContactInput, { message });
        }
      }
    },
  });

  if (mutation.isSuccess) {
    return (
      <div className="rounded-2xl border border-positive/40 bg-positive/5 p-6 text-center">
        <h3 className="font-semibold text-primary">{t('successTitle')}</h3>
        <p className="mt-2 text-sm leading-relaxed text-secondary">{t('successText')}</p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-4"
          onClick={() => {
            reset();
            mutation.reset();
          }}
        >
          {t('writeAgain')}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit((d) => mutation.mutate(d))} noValidate className="space-y-5">
      {/* Honeypot для ботов */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
        className="absolute -left-[9999px] h-0 w-0 opacity-0"
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label={t('name')} htmlFor="ct-name" required error={msg(errors.name?.message)}>
          <Input id="ct-name" autoComplete="name" invalid={!!errors.name} {...register('name')} />
        </FormField>
        <FormField label={t('email')} htmlFor="ct-email" required error={msg(errors.email?.message)}>
          <Input
            id="ct-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            invalid={!!errors.email}
            {...register('email')}
          />
        </FormField>
      </div>

      <FormField label={t('topic')} htmlFor="ct-topic" required error={msg(errors.topic?.message)}>
        <Select id="ct-topic" invalid={!!errors.topic} {...register('topic')}>
          {topics.map((topic) => (
            <option key={topic.value} value={topic.value}>
              {topic.label}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField label={t('message')} htmlFor="ct-message" required error={msg(errors.message?.message)}>
        <textarea
          id="ct-message"
          rows={5}
          aria-invalid={!!errors.message || undefined}
          className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm text-primary transition-colors placeholder:text-secondary/60 focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/20 aria-[invalid]:border-negative/60"
          placeholder={t('messagePlaceholder')}
          {...register('message')}
        />
      </FormField>

      {mutation.isError && !(mutation.error as ApiFieldErrors).fieldErrors && (
        <p role="alert" className="rounded-xl bg-negative/10 px-4 py-3 text-sm text-negative">
          {msg((mutation.error as Error).message) ?? tv('generic')}
        </p>
      )}

      <Button type="submit" size="lg" className="w-full sm:w-auto sm:px-10" loading={mutation.isPending}>
        {t('submit')}
      </Button>
    </form>
  );
}
