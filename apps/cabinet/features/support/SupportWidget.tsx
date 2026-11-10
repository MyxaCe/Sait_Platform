'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, cn } from '@broker/ui';
import type { SupportWidgetState } from '@/lib/support/state';

/**
 * Кнопка «Поддержка» в правом нижнем углу кабинета + панель диалога (дизайн
 * §2-A). На телефоне — над нижней навигацией, панель — во весь экран.
 * Опрос раз в 4 с, пока панель открыта; закрытая — раз в 30 с (бейдж).
 * Тексты приветствия / «вне часов» / оценки — из настроек поддержки.
 */

const ERR_KEYS = ['rateLimited', 'fileTooLarge', 'unsupportedFormat', 'attachmentsUnavailable', 'channelDisabled', 'emptyBody'] as const;

function fmtTime(iso: string, locale: string): string {
  const d = new Date(iso);
  const sameDay = new Date().toDateString() === d.toDateString();
  return d.toLocaleString(locale === 'en' ? 'en-GB' : 'ru-RU', sameDay ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function SupportWidget({ initialUnread, locale, enabled }: { initialUnread: number; locale: string; enabled: boolean }) {
  const t = useTranslations('support');
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<SupportWidgetState | null>(null);
  const [unread, setUnread] = useState(initialUnread);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [view, setView] = useState<'chat' | 'history'>('chat');
  const [body, setBody] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/support/chat${ticketId ? `?ticket=${ticketId}` : ''}`, { cache: 'no-store' }).catch(() => null);
    if (!r?.ok) return;
    const s = (await r.json()) as SupportWidgetState;
    setState(s);
    setUnread(s.chat.unread);
  }, [ticketId]);

  useEffect(() => {
    const ms = open ? 4000 : 30000;
    if (open) void load();
    const h = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, ms);
    return () => clearInterval(h);
  }, [open, load]);

  const tid = state?.chat.ticket?.id;
  const msgCount = state?.chat.messages.length ?? 0;
  useEffect(() => {
    if (!open || !tid) return;
    if (unread > 0) {
      void fetch('/api/support/read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticketId: tid }) }).then(() => setUnread(0));
    }
  }, [open, tid, unread]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [msgCount, open, view]);

  if (!enabled) return null;

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim() && !file) return;
    setSending(true);
    setError(null);
    const fd = new FormData();
    fd.set('body', body);
    if (file) fd.set('file', file);
    const r = await fetch('/api/support/chat', { method: 'POST', body: fd }).catch(() => null);
    setSending(false);
    if (!r) return setError('generic');
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setError(typeof j.error === 'string' ? j.error : 'generic');
    setState(j as SupportWidgetState);
    setTicketId((j as SupportWidgetState).chat.ticket?.id ?? null);
    setBody('');
    setFile(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function rate(n: number) {
    if (!tid) return;
    setScore(n);
    const r = await fetch('/api/support/rate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticketId: tid, score: n }) }).catch(() => null);
    if (r?.ok) setState((await r.json()) as SupportWidgetState);
  }

  const ticket = state?.chat.ticket ?? null;
  const resolved = ticket && (ticket.status === 'resolved' || ticket.status === 'closed');
  const closedTicket = ticket?.status === 'closed';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="support-panel"
        aria-label={unread > 0 ? t('openWithUnread', { count: unread }) : t('open')}
        className={cn(
          'fixed right-4 z-40 flex h-12 items-center gap-2 rounded-full bg-accent px-4 text-sm font-medium text-on-accent shadow-lg transition-transform hover:bg-accent-hover',
          'bottom-[calc(5.25rem+env(safe-area-inset-bottom))] lg:bottom-6 lg:right-6',
          open && 'max-lg:hidden',
        )}
      >
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 5h16v11H9l-5 4zM8 9h8M8 12h5" />
        </svg>
        <span>{t('button')}</span>
        {unread > 0 ? (
          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-negative px-1.5 text-[11px] font-semibold tabular-nums text-on-negative">{unread > 9 ? '9+' : unread}</span>
        ) : null}
      </button>

      {open ? (
        <section
          id="support-panel"
          role="dialog"
          aria-label={t('title')}
          className="fixed inset-0 z-50 flex flex-col bg-elevated lg:inset-auto lg:bottom-24 lg:right-6 lg:h-[min(620px,calc(100svh-8rem))] lg:w-[400px] lg:rounded-2xl lg:border lg:border-border lg:shadow-2xl"
        >
          <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <h2 className="font-semibold">
                {t('title')}
                {ticket && view === 'chat' ? <span className="ml-2 text-sm font-normal text-muted tabular-nums">#{ticket.number}</span> : null}
              </h2>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-secondary">
                <span aria-hidden className={cn('size-2 rounded-full', state?.online ? 'bg-positive' : 'bg-warning')} />
                {state ? (state.online ? t('online', { minutes: state.slaMinutes }) : t('offline', { hours: state.hours })) : t('loading')}
              </p>
            </div>
            <div className="flex items-center gap-1">
              {state && state.chat.history.length > 0 ? (
                <button type="button" onClick={() => setView((v) => (v === 'chat' ? 'history' : 'chat'))} className="h-9 rounded-lg px-2.5 text-xs text-secondary hover:bg-primary/5 hover:text-primary">
                  {view === 'chat' ? t('history') : t('backToChat')}
                </button>
              ) : null}
              <button type="button" onClick={() => setOpen(false)} aria-label={t('close')} className="grid size-9 place-items-center rounded-lg text-secondary hover:bg-primary/5 hover:text-primary">
                <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          </header>

          {view === 'history' && state ? (
            <ul className="flex-1 divide-y divide-border overflow-y-auto">
              {state.chat.history.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setTicketId(h.id);
                      setView('chat');
                    }}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-primary/5"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm">
                        <span className="text-muted tabular-nums">#{h.number}</span> {h.subject}
                      </span>
                      <span className="block text-xs text-muted">{fmtTime(h.createdAt, locale)}</span>
                    </span>
                    <span className="shrink-0 rounded-full bg-primary/5 px-2 py-0.5 text-[11px] text-secondary">{t(`status.${h.status}`)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
              <div className="rounded-xl bg-primary/5 px-3.5 py-2.5 text-sm text-secondary">{state?.greeting ?? '…'}</div>
              {state && !state.online && !ticket ? <div className="rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-sm">{state.offHours}</div> : null}
              {state?.chat.messages.map((m) => (
                <div key={m.id} className={cn('flex flex-col', m.mine ? 'items-end' : 'items-start')}>
                  <div
                    className={cn(
                      'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm',
                      m.mine ? 'rounded-br-md bg-accent text-on-accent' : m.authorKind === 'operator' ? 'rounded-bl-md border border-border bg-card' : 'rounded-bl-md border border-dashed border-border text-secondary',
                    )}
                  >
                    {m.body}
                    {m.attachments.map((a) => (
                      <a key={a.id} href={`/api/support/attachments/${a.id}`} target="_blank" rel="noreferrer" className={cn('mt-1 block truncate text-xs underline', m.mine ? 'text-on-accent' : 'text-accent')}>
                        📎 {a.filename}
                      </a>
                    ))}
                  </div>
                  <span className="mt-1 px-1 text-[11px] text-muted">
                    {m.mine ? t('you') : m.authorKind === 'operator' ? m.authorName ?? t('agent') : t('autoReply')} · {fmtTime(m.createdAt, locale)}
                  </span>
                </div>
              ))}
              {resolved && ticket ? (
                <div className="rounded-xl border border-border bg-card px-3.5 py-3 text-sm">
                  <p className="font-medium">{t('resolvedTitle', { number: ticket.number })}</p>
                  {ticket.csatScore ? (
                    <p className="mt-1 text-secondary">{t('rated', { score: ticket.csatScore })}</p>
                  ) : (
                    <>
                      <p className="mt-1 text-secondary">{state?.csatPrompt}</p>
                      <div className="mt-2 flex gap-1.5" role="group" aria-label={t('rateLabel')}>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => void rate(n)}
                            aria-label={t('rateN', { n })}
                            className={cn('grid size-10 place-items-center rounded-lg border text-sm font-semibold tabular-nums', score >= n ? 'border-accent bg-accent/15 text-accent' : 'border-border hover:border-accent')}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {!closedTicket ? <p className="mt-2 text-xs text-muted">{t('reopenHint')}</p> : null}
                </div>
              ) : null}
            </div>
          )}

          {view === 'chat' ? (
            <form onSubmit={send} className="border-t border-border px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 lg:pb-3">
              {error ? (
                <p role="alert" className="mb-2 rounded-lg bg-negative/10 px-3 py-2 text-xs text-negative">
                  {(ERR_KEYS as readonly string[]).includes(error) ? t(`errors.${error}`) : t('errors.generic')}
                </p>
              ) : null}
              {closedTicket ? <p className="mb-2 text-xs text-muted">{t('closedHint')}</p> : null}
              {file ? (
                <p className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-primary/5 px-3 py-1.5 text-xs">
                  <span className="truncate">📎 {file.name}</span>
                  <button type="button" className="text-secondary hover:text-primary" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ''; }}>
                    {t('removeFile')}
                  </button>
                </p>
              ) : null}
              <div className="flex items-end gap-2">
                <label className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg text-secondary hover:bg-primary/5 hover:text-primary" title={t('attach')}>
                  <span className="sr-only">{t('attach')}</span>
                  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M21 11l-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7" />
                  </svg>
                  <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send(e as unknown as React.FormEvent);
                    }
                  }}
                  rows={2}
                  maxLength={10000}
                  placeholder={t('placeholder')}
                  aria-label={t('placeholder')}
                  className="min-h-11 flex-1 resize-none rounded-xl border border-border bg-sunken px-3 py-2.5 text-[15px] outline-none focus:border-accent"
                />
                <Button type="submit" size="md" className="shrink-0 px-4" disabled={sending || (!body.trim() && !file)} loading={sending}>
                  {t('send')}
                </Button>
              </div>
              <p className="mt-1.5 px-1 text-[11px] text-muted">{t('attachHint', { mb: Math.round((state?.maxBytes ?? 10485760) / 1048576) })}</p>
            </form>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
