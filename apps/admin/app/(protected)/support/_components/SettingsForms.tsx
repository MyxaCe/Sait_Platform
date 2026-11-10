'use client';

import { useId, useState, type ReactNode } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Button, Callout, Checkbox, Input, Panel, Select, Textarea, cn } from '@broker/ui';
import type { SupportActionState } from '@/lib/support/actions';
import { SETTINGS_ERROR_TEXT, supportErrorText } from '@/lib/support/labels';

/**
 * Формы администрирования поддержки (admin): настройки и шаблоны ответов.
 * Имена полей разбирает `formToSettings` (lib/support/actions.ts); строгая
 * проверка — в пакете (`validateSettings`), ошибки возвращаются по полям.
 */

type Action = (s: SupportActionState, fd: FormData) => Promise<SupportActionState>;

function Submit({ label, disabled }: { label: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="compact" loading={pending} disabled={pending || disabled}>
      {label}
    </Button>
  );
}

function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block space-y-1.5', className)}>
      <span className="text-muted block text-xs">{label}</span>
      {children}
      {error ? (
        <span className="text-negative block text-xs">{SETTINGS_ERROR_TEXT[error] ?? error}</span>
      ) : hint ? (
        <span className="text-muted block text-xs">{hint}</span>
      ) : null}
    </label>
  );
}

function Toggle({ name, defaultChecked, title, on, off }: { name: string; defaultChecked: boolean; title: string; on: string; off: string }) {
  return (
    <label className="border-border bg-sunken hover:border-border-strong flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5">
      <Checkbox name={name} defaultChecked={defaultChecked} className="mt-0.5 size-4" />
      <span className="min-w-0">
        <span className="text-primary block text-sm font-medium">{title}</span>
        <span className="text-muted block text-xs">Включено: {on}</span>
        <span className="text-muted block text-xs">Выключено: {off}</span>
      </span>
    </label>
  );
}

export interface SettingsFormValues {
  channels: { chat: boolean; webForm: boolean; email: boolean };
  timezone: string;
  alwaysOpen: boolean;
  week: { key: string; label: string; on: boolean; open: string; close: string }[];
  holidays: string;
  sla: { chat: number; email: number; webForm: number };
  autoReply: boolean;
  autoCloseDays: number;
  maxMb: string;
  limits: { chat: number; email: number };
  fromName: string;
  categories: string;
  texts: { key: string; label: string; rows: number; ru: string; en: string }[];
}

const SLA_FIELDS = [
  { name: 'sla.chatFirstResponseMinutes', label: 'Чат кабинета, мин', pick: (v: SettingsFormValues) => v.sla.chat },
  { name: 'sla.emailFirstResponseMinutes', label: 'Почта, мин', pick: (v: SettingsFormValues) => v.sla.email },
  { name: 'sla.webFormFirstResponseMinutes', label: 'Форма сайта, мин', pick: (v: SettingsFormValues) => v.sla.webForm },
];

export function SupportSettingsForm({ action, initial, mailInfo }: { action: Action; initial: SettingsFormValues; mailInfo: ReactNode }) {
  const [state, formAction] = useFormState(action, {});
  const [reason, setReason] = useState('');
  const err = (k: string) => state.fields?.[k];
  const reasonId = useId();
  const weekError = err('hours.week') ?? initial.week.map((d) => err(`hours.week.${d.key}`)).find(Boolean);
  return (
    <form action={formAction} className="space-y-5">
      {state.error ? (
        <Callout tone="negative" title="Не сохранено">
          {state.error === 'invalid' ? 'Исправьте отмеченные поля.' : supportErrorText(state.error)}
        </Callout>
      ) : state.ok ? (
        <Callout tone="positive">Сохранено, запись в журнале (до/после). Виджет кабинета и форма сайта подхватят изменения сразу.</Callout>
      ) : null}

      <Panel title="Каналы" description="Выключенный канал не принимает новых обращений; открытые тикеты остаются в очереди.">
        <div className="grid gap-3 lg:grid-cols-3">
          <Toggle name="channels.chat" defaultChecked={initial.channels.chat} title="Чат в кабинете" on="кнопка «Поддержка» в углу кабинета." off="кнопки нет, клиент видит контакты." />
          <Toggle name="channels.webForm" defaultChecked={initial.channels.webForm} title="Форма на сайте" on="гость пишет с витрины, ответ — на почту." off="форма обращения скрыта." />
          <Toggle name="channels.email" defaultChecked={initial.channels.email} title="Почта поддержки" on="письма в ящик становятся тикетами, ответы — письмом." off="письма ждут во входящих, ответить письмом нельзя." />
        </div>
      </Panel>

      <Panel title="Рабочие часы" description="SLA считается только в рабочее время. Вне часов клиент видит текст «вне часов» и получает автоответ.">
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <Field label="Часовой пояс (IANA)" error={err('hours.timezone')} className="w-64">
              <Input name="hours.timezone" defaultValue={initial.timezone} controlSize="compact" placeholder="Europe/Moscow" />
            </Field>
            <label className="text-secondary flex h-9 items-center gap-2 text-sm">
              <Checkbox name="hours.alwaysOpen" defaultChecked={initial.alwaysOpen} className="size-4" /> Круглосуточно (часы ниже не учитываются)
            </label>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {initial.week.map((d) => (
              <div key={d.key} className="border-border flex items-center gap-2 rounded-md border px-2.5 py-2">
                <label className="text-primary flex w-14 items-center gap-1.5 text-sm">
                  <Checkbox name={`hours.week.${d.key}.on`} defaultChecked={d.on} className="size-4" /> {d.label}
                </label>
                <Input name={`hours.week.${d.key}.open`} defaultValue={d.open} controlSize="compact" className="w-[4.75rem] tabular-nums" aria-label={`${d.label}: открытие`} />
                <span className="text-muted">–</span>
                <Input name={`hours.week.${d.key}.close`} defaultValue={d.close} controlSize="compact" className="w-[4.75rem] tabular-nums" aria-label={`${d.label}: закрытие`} />
              </div>
            ))}
          </div>
          {weekError ? <p className="text-negative text-xs">{SETTINGS_ERROR_TEXT[weekError] ?? weekError}</p> : null}
          <Field label="Праздники (ГГГГ-ММ-ДД, через пробел или с новой строки)" error={err('hours.holidays')}>
            <Textarea name="hours.holidays" rows={2} defaultValue={initial.holidays} placeholder="2026-12-31 2027-01-01" />
          </Field>
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="SLA первого ответа" description="В рабочих минутах. Просроченные — сверху очереди и с пометкой.">
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            {SLA_FIELDS.map((f) => (
              <Field key={f.name} label={f.label} error={err('sla')} className="w-40">
                <Input name={f.name} defaultValue={String(f.pick(initial))} controlSize="compact" inputMode="numeric" className="text-right tabular-nums" />
              </Field>
            ))}
          </div>
        </Panel>
        <Panel title="Автоответ, закрытие, лимиты">
          <div className="space-y-3">
            <label className="text-secondary flex items-center gap-2 text-sm">
              <Checkbox name="autoReply.enabled" defaultChecked={initial.autoReply} className="size-4" /> Автоответ: подтверждение письмом и «вне часов» в чате
            </label>
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              <Field label="Автозакрытие решённых, дней" error={err('autoCloseDays')} className="w-44">
                <Input name="autoCloseDays" defaultValue={String(initial.autoCloseDays)} controlSize="compact" inputMode="numeric" className="text-right tabular-nums" />
              </Field>
              <Field label="Вложение до, МБ" error={err('attachments.maxBytes')} hint="PDF, JPG, PNG" className="w-36">
                <Input name="attachments.maxMb" defaultValue={initial.maxMb} controlSize="compact" inputMode="decimal" className="text-right tabular-nums" />
              </Field>
              <Field label="Сообщений в чат в минуту" error={err('limits.chatMessagesPerMinute')} className="w-44">
                <Input name="limits.chatMessagesPerMinute" defaultValue={String(initial.limits.chat)} controlSize="compact" inputMode="numeric" className="text-right tabular-nums" />
              </Field>
              <Field label="Писем с адреса в час" error={err('limits.emailsPerSenderPerHour')} className="w-44">
                <Input name="limits.emailsPerSenderPerHour" defaultValue={String(initial.limits.email)} controlSize="compact" inputMode="numeric" className="text-right tabular-nums" />
              </Field>
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Почта" description="Адрес, сервер и пароль ящика — в окружении сервера ячейки, не здесь.">
          <div className="space-y-3">
            {mailInfo}
            <Field label="Имя отправителя в письмах" error={err('mail.fromName')} className="max-w-sm">
              <Input name="mail.fromName" defaultValue={initial.fromName} controlSize="compact" />
            </Field>
          </div>
        </Panel>
        <Panel title="Категории обращений" description="Строка: ключ | по-русски | по-английски. Ключ — латиница, без повторов.">
          <Field label="Категории" error={err('categories')}>
            <Textarea name="categories" rows={6} defaultValue={initial.categories} className="font-mono text-[13px]" />
          </Field>
        </Panel>
      </div>

      <Panel
        title="Тексты для клиента"
        description="Переменные: {{client.firstName}}, {{ticket.number}}, {{operator.name}}, {{hours}}; в письмах входа — {{link}}, {{ttlMinutes}}, {{ttlHours}}. Ключи совпадают с будущим глобалом CMS «Поддержка»."
      >
        <div className="space-y-4">
          {initial.texts.map((t) => (
            <div key={t.key} className="grid gap-3 lg:grid-cols-2">
              <Field label={`${t.label} · RU`} error={err(`texts.ru.${t.key}`)}>
                <Textarea name={`texts.ru.${t.key}`} rows={t.rows} defaultValue={t.ru} />
              </Field>
              <Field label={`${t.label} · EN`} error={err(`texts.en.${t.key}`)}>
                <Textarea name={`texts.en.${t.key}`} rows={t.rows} defaultValue={t.en} />
              </Field>
            </div>
          ))}
        </div>
      </Panel>

      <Panel>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor={reasonId} className="text-muted block text-xs">
              Основание
            </label>
            <Textarea id={reasonId} name="reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Почему меняются настройки поддержки" />
            <p className="text-muted text-xs">Обязательно. Пишется в неизменяемый журнал вместе с полной копией «до/после».</p>
          </div>
          <Submit label="Сохранить настройки" disabled={!reason.trim()} />
        </div>
      </Panel>
    </form>
  );
}

/* ─── Шаблон ответа ─────────────────────────────────────────────────── */

export interface TemplateFormValues {
  id: string | null;
  key: string;
  locale: 'ru' | 'en';
  title: string;
  body: string;
  category: string;
  active: boolean;
}

export function TemplateForm({ action, initial, categories }: { action: Action; initial: TemplateFormValues; categories: { key: string; label: string }[] }) {
  const [state, formAction] = useFormState(action, {});
  return (
    <form action={formAction} className="space-y-3">
      {state.error ? <Callout tone="negative">{supportErrorText(state.error)}</Callout> : state.ok ? <Callout tone="positive">Шаблон сохранён, запись в журнале.</Callout> : null}
      <input type="hidden" name="id" value={initial.id ?? ''} />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
        <Field label="Название (видит оператор в списке)">
          <Input name="title" defaultValue={initial.title} controlSize="compact" required />
        </Field>
        <Field label="Язык">
          <Select name="locale" defaultValue={initial.locale} controlSize="compact">
            <option value="ru">RU</option>
            <option value="en">EN</option>
          </Select>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Ключ (латиница, для журнала)" hint="напр. kyc.docs">
          <Input name="key" defaultValue={initial.key} controlSize="compact" className="font-mono" required />
        </Field>
        <Field label="Категория">
          <Select name="category" defaultValue={initial.category} controlSize="compact">
            <option value="">— любая —</option>
            {categories.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Текст" hint="{{client.firstName}}, {{ticket.number}}, {{operator.name}}, {{hours}}">
        <Textarea name="body" rows={7} defaultValue={initial.body} required />
      </Field>
      <label className="text-secondary flex items-center gap-2 text-sm">
        <Checkbox name="active" defaultChecked={initial.active} className="size-4" /> Активен (виден операторам)
      </label>
      <Submit label={initial.id ? 'Сохранить шаблон' : 'Создать шаблон'} />
    </form>
  );
}
