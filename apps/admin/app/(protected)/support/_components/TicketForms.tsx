'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Button, Callout, Checkbox, Select, Textarea, cn } from '@broker/ui';
import type { SupportActionState } from '@/lib/support/actions';
import { supportErrorText } from '@/lib/support/labels';

/**
 * Формы экрана обращения. Server actions — `lib/support/actions.ts`;
 * личность и права — на сервере. Итог — Callout у формы (концепция §6.6),
 * без тостов.
 */

type Action = (s: SupportActionState, fd: FormData) => Promise<SupportActionState>;

function Submit({ label, variant = 'primary', disabled, size = 'compact' }: { label: string; variant?: 'primary' | 'secondary' | 'danger' | 'danger-outline'; disabled?: boolean; size?: 'compact' | 'xs' }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size={size} variant={variant} loading={pending} disabled={pending || disabled}>
      {label}
    </Button>
  );
}

function Result({ state, ok }: { state: SupportActionState; ok?: string }) {
  if (state.error) return <Callout tone="negative">{supportErrorText(state.error)}</Callout>;
  if (state.ok && ok) return <Callout tone="positive">{ok}</Callout>;
  return null;
}

/* ─── Ответ / заметка ───────────────────────────────────────────────── */

export interface TemplateOption {
  key: string;
  title: string;
  /** Уже с подставленными переменными тикета. */
  text: string;
}

export function Composer({
  action,
  ticketId,
  ticketNumber,
  replyChannel,
  canReply,
  templates,
  contactEmail,
}: {
  action: Action;
  ticketId: string;
  ticketNumber: number;
  replyChannel: 'chat' | 'email';
  canReply: boolean;
  templates: TemplateOption[];
  contactEmail: string;
}) {
  const [state, formAction] = useFormState(action, {});
  const [mode, setMode] = useState<'reply' | 'note'>(canReply ? 'reply' : 'note');
  const [body, setBody] = useState('');
  const [templateKey, setTemplateKey] = useState('');
  const seen = useRef(state.seq);
  const id = useId();
  useEffect(() => {
    if (state.ok && state.seq !== seen.current) {
      seen.current = state.seq;
      setBody('');
      setTemplateKey('');
    }
  }, [state]);

  const note = mode === 'note';
  return (
    <form action={formAction} className={cn('space-y-3 rounded-md border p-3', note ? 'border-warning/40 bg-warning/[0.05]' : 'border-border bg-card')}>
      <input type="hidden" name="ticketId" value={ticketId} />
      <input type="hidden" name="ticketNumber" value={ticketNumber} />
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="templateKey" value={note ? '' : templateKey} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Тип сообщения" className="bg-sunken inline-flex rounded-md p-0.5 text-[13px]">
          {canReply ? (
            <button
              type="button"
              role="tab"
              aria-selected={!note}
              onClick={() => setMode('reply')}
              className={cn('rounded px-3 py-1.5', !note ? 'bg-card text-primary font-medium shadow-sm' : 'text-secondary hover:text-primary')}
            >
              Ответ клиенту
            </button>
          ) : null}
          <button
            type="button"
            role="tab"
            aria-selected={note}
            onClick={() => setMode('note')}
            className={cn('rounded px-3 py-1.5', note ? 'bg-card text-primary font-medium shadow-sm' : 'text-secondary hover:text-primary')}
          >
            Внутренняя заметка
          </button>
        </div>
        {!note && templates.length > 0 ? (
          <label className="flex items-center gap-2 text-xs text-muted">
            Шаблон
            <Select
              controlSize="compact"
              className="w-60"
              value={templateKey}
              onChange={(e) => {
                const t = templates.find((x) => x.key === e.target.value);
                setTemplateKey(e.target.value);
                if (t) setBody(t.text);
              }}
            >
              <option value="">— без шаблона —</option>
              {templates.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.title}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
      </div>
      <Result state={state} />
      <label htmlFor={id} className="sr-only">
        {note ? 'Текст заметки' : 'Текст ответа'}
      </label>
      <Textarea
        id={id}
        name="body"
        rows={5}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={note ? 'Заметка видна только операторам. Клиенту не уходит никогда.' : 'Ответ клиенту…'}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted text-xs">
          {note
            ? 'Внутренняя заметка — в журнал пишется факт и хеш текста.'
            : replyChannel === 'email'
              ? `Уйдёт письмом на ${contactEmail} (с подписью из настроек). В журнал — факт и хеш текста.`
              : 'Уйдёт в чат кабинета клиента + уведомление. В журнал — факт и хеш текста.'}
        </p>
        <Submit label={note ? 'Добавить заметку' : replyChannel === 'email' ? 'Отправить письмо' : 'Отправить в чат'} variant={note ? 'secondary' : 'primary'} disabled={!body.trim()} />
      </div>
    </form>
  );
}

/* ─── Назначение ────────────────────────────────────────────────────── */

export function AssignForm({
  action,
  ticketId,
  ticketNumber,
  current,
  operators,
  selfId,
}: {
  action: Action;
  ticketId: string;
  ticketNumber: number;
  current: string | null;
  operators: { id: string; name: string; roleLabel: string }[];
  selfId: string;
}) {
  const [state, formAction] = useFormState(action, {});
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="ticketId" value={ticketId} />
      <input type="hidden" name="ticketNumber" value={ticketNumber} />
      <Result state={state} ok="Назначение сохранено, запись в журнале." />
      <div className="flex gap-2">
        <Select name="assigneeId" controlSize="compact" defaultValue={current ?? ''} className="min-w-0 flex-1" aria-label="Назначить оператора">
          <option value="">— не назначено —</option>
          {operators.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
              {o.id === selfId ? ' (я)' : ''} · {o.roleLabel}
            </option>
          ))}
        </Select>
        <Submit label="Назначить" variant="secondary" />
      </div>
    </form>
  );
}

/* ─── Смена статуса ─────────────────────────────────────────────────── */

export function StatusForm({
  action,
  ticketId,
  ticketNumber,
  options,
}: {
  action: Action;
  ticketId: string;
  ticketNumber: number;
  options: { to: string; label: string; primary?: boolean }[];
}) {
  const [state, formAction] = useFormState(action, {});
  if (options.length === 0) return null;
  const preferred = options.find((o) => o.primary) ?? options[0]!;
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="ticketId" value={ticketId} />
      <input type="hidden" name="ticketNumber" value={ticketNumber} />
      <Result state={state} ok="Статус изменён, запись в журнале." />
      <div className="flex gap-2">
        <Select name="to" controlSize="compact" defaultValue={preferred.to} className="min-w-0 flex-1" aria-label="Новый статус">
          {options.map((o) => (
            <option key={o.to} value={o.to}>
              {o.label}
            </option>
          ))}
        </Select>
        <Submit label="Применить" variant="secondary" />
      </div>
      <Textarea name="reason" rows={2} placeholder="Комментарий (необязательно) — пишется в журнал" />
    </form>
  );
}

/* ─── Спам (опасная зона, два шага) ─────────────────────────────────── */

export function SpamForm({ action, ticketId, ticketNumber, email }: { action: Action; ticketId: string; ticketNumber: number; email: string }) {
  const [state, formAction] = useFormState(action, {});
  const [reason, setReason] = useState('');
  const [armed, setArmed] = useState(false);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="ticketId" value={ticketId} />
      <input type="hidden" name="ticketNumber" value={ticketNumber} />
      <input type="hidden" name="to" value="spam" />
      <Result state={state} ok="Помечено как спам, запись в журнале." />
      <Textarea
        name="reason"
        rows={2}
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
          setArmed(false);
        }}
        placeholder="Основание (обязательно) — пишется в неизменяемый журнал"
      />
      <label className="text-secondary flex items-center gap-2 text-[13px]">
        <Checkbox name="blockSender" className="size-4" /> Заблокировать отправителя {email} (письма с адреса не станут обращениями)
      </label>
      {armed ? (
        <div className="border-negative/40 bg-negative/[0.06] space-y-2 rounded-md border p-3">
          <p className="text-negative text-[13px]">Обращение уйдёт из очереди со статусом «Спам». Ответить в него будет нельзя, пока не вернут в работу.</p>
          <div className="flex gap-2">
            <Submit label="Да, это спам" variant="danger" disabled={!reason.trim()} />
            <Button type="button" size="compact" variant="secondary" onClick={() => setArmed(false)}>
              Отмена
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" size="compact" variant="danger-outline" disabled={!reason.trim()} onClick={() => setArmed(true)}>
          Пометить как спам…
        </Button>
      )}
    </form>
  );
}

/* ─── Склейка гостя с клиентом ──────────────────────────────────────── */

export function LinkClientForm({
  action,
  ticketId,
  ticketNumber,
  candidates,
}: {
  action: Action;
  ticketId: string;
  ticketNumber: number;
  candidates: { id: string; fullName: string; email: string }[];
}) {
  const [state, formAction] = useFormState(action, {});
  const [reason, setReason] = useState('');
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="ticketId" value={ticketId} />
      <input type="hidden" name="ticketNumber" value={ticketNumber} />
      <Result state={state} ok="Обращение привязано к клиенту, запись в журнале." />
      <Select name="userId" controlSize="compact" aria-label="Клиент">
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>
            {c.fullName} · {c.email}
          </option>
        ))}
      </Select>
      <Textarea name="reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Основание (обязательно): почему это тот же человек" />
      <Submit label="Привязать к клиенту" variant="secondary" disabled={!reason.trim()} />
    </form>
  );
}

/* ─── Повтор недоставленного письма ─────────────────────────────────── */

export function RequeueButton({ action, outboundId, ticketNumber }: { action: Action; outboundId: string; ticketNumber: number }) {
  const [state, formAction] = useFormState(action, {});
  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="outboundId" value={outboundId} />
      <input type="hidden" name="ticketNumber" value={ticketNumber} />
      <Submit label="Отправить ещё раз" variant="secondary" size="xs" />
      {state.error ? <span className="text-negative text-xs">{supportErrorText(state.error)}</span> : null}
    </form>
  );
}
