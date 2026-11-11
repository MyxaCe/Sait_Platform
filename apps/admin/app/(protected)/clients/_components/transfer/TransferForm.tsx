'use client';

import { useMemo, useState } from 'react';
import { Callout, Checkbox, ToneBadge, cn } from '@broker/ui';
import { createTransferAction } from '@/lib/transfer/actions';
import { transferErrorText } from '@/lib/transfer/labels';
import { ActionForm, ConfirmFacts } from '../../../_money/ActionForm';

/**
 * Форма «Перевести клиента на другую платформу группы» (менеджер клиента).
 *
 * Шаги на одной странице: 1) платформа группы из реестра — запрещённые
 * направления видны, но не выбираются; 2) тикет-заявление клиента (только те,
 * где первое сообщение написал клиент; открытые оператором показаны
 * отвергнутыми); 3) сообщение клиента с согласием + отметка; 4) основание и
 * подтверждение. Без платформы, тикета, сообщения-согласия и отметки
 * «Провести перевод» неактивна; сервер проверяет всё повторно.
 */

export interface TargetOption {
  slug: string;
  name: string;
  legalEntity: string | null;
  euLicense: boolean;
  maxRetailLeverage: number | null;
  blockers: string[];
  blockerText: string[];
  hintText: string[];
}

export interface TicketOption {
  ticketId: string;
  number: number;
  subject: string;
  createdAt: string;
  originChannel: string;
  firstExcerpt: string;
  usedByTransfer: string | null;
  clientMessages: { id: string; createdAt: string; excerpt: string }[];
}

const CHANNEL: Record<string, string> = { chat: 'чат кабинета', email: 'письмо', web_form: 'форма сайта' };

function Step({ n, title, children, done }: { n: number; title: string; children: React.ReactNode; done: boolean }) {
  return (
    <section className="space-y-3">
      <h3 className="text-primary flex items-center gap-2 text-sm font-semibold">
        <span
          className={cn(
            'inline-flex size-5 items-center justify-center rounded-full text-[11px] tabular-nums',
            done ? 'bg-positive/15 text-positive' : 'bg-primary/[0.08] text-secondary',
          )}
        >
          {n}
        </span>
        {title}
      </h3>
      <div className="pl-7">{children}</div>
    </section>
  );
}

export function TransferForm({
  userId,
  clientName,
  targets,
  tickets,
  rejected,
  consentText,
  consentVersion,
}: {
  userId: string;
  clientName: string;
  targets: TargetOption[];
  tickets: TicketOption[];
  rejected: { number: number; subject: string; reason: string }[];
  consentText: string;
  consentVersion: string;
}) {
  const [target, setTarget] = useState('');
  const [ticketId, setTicketId] = useState('');
  const [consentId, setConsentId] = useState('');
  const [consentOk, setConsentOk] = useState(false);
  const ticket = useMemo(() => tickets.find((t) => t.ticketId === ticketId) ?? null, [tickets, ticketId]);
  const targetOpt = targets.find((t) => t.slug === target) ?? null;
  const valid = Boolean(targetOpt && targetOpt.blockers.length === 0 && ticket && !ticket.usedByTransfer && consentId && consentOk);

  return (
    <ActionForm
      action={createTransferAction}
      submitLabel="Провести перевод"
      okText="Перевод проведён."
      errorText={transferErrorText}
      extraValid={valid}
      disarmOn={`${target}|${ticketId}|${consentId}|${consentOk}`}
      reasonLabel="Основание"
      reasonPlaceholder="Что просит клиент в заявлении (кратко), почему перевод уместен"
      confirm={{
        tone: 'primary',
        title: 'Провести перевод?',
        summary: (
          <ConfirmFacts
            rows={[
              ['Клиент', clientName],
              ['Платформа', targetOpt ? `${targetOpt.name}${targetOpt.legalEntity ? ` · ${targetOpt.legalEntity}` : ''}` : '—'],
              ['Заявление', ticket ? `тикет #${ticket.number} · ${ticket.subject}` : '—'],
            ]}
          />
        ),
        consequence:
          'Пакет с ФИО, email, страной, языком и статусом KYC уйдёт платформе-цели сразу; клиент получит от неё письмо и зарегистрируется сам. Администратор увидит перевод и может его вернуть. Деньги не переносятся.',
        confirmLabel: 'Да, провести перевод',
      }}
    >
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="target" value={target} />
      <input type="hidden" name="ticketId" value={ticketId} />
      <input type="hidden" name="consentMessageId" value={consentId} />
      <input type="hidden" name="consentConfirmed" value={consentOk ? 'on' : ''} />

      <div className="space-y-6">
        <Step n={1} title="Платформа группы" done={Boolean(targetOpt && !targetOpt.blockers.length)}>
          {targets.length === 0 ? (
            <Callout tone="warning" title="Других платформ в реестре нет">
              Реестр платформ группы ведёт администратор в «Настройках платформы».
            </Callout>
          ) : (
            <div className="grid gap-2 lg:grid-cols-2" role="radiogroup" aria-label="Платформа группы">
              {targets.map((t) => {
                const blocked = t.blockers.length > 0;
                const active = t.slug === target;
                return (
                  <button
                    key={t.slug}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={blocked}
                    onClick={() => setTarget(t.slug)}
                    className={cn(
                      'rounded-md border px-3 py-2.5 text-left transition-colors',
                      blocked
                        ? 'border-border bg-sunken cursor-not-allowed opacity-80'
                        : active
                          ? 'border-accent bg-accent/[0.06] ring-accent/30 ring-1'
                          : 'border-border hover:border-border-strong bg-card',
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-primary text-sm font-medium">{t.name}</span>
                      {blocked ? (
                        <ToneBadge tone="negative">запрещено</ToneBadge>
                      ) : t.hintText.length ? (
                        <ToneBadge tone="warning">подсказки: {t.hintText.length}</ToneBadge>
                      ) : (
                        <ToneBadge tone="positive">допустимо</ToneBadge>
                      )}
                    </span>
                    <span className="text-muted mt-0.5 block text-xs">
                      {t.legalEntity ?? t.slug} · лицензия ЕС: {t.euLicense ? 'да' : 'нет'}
                      {t.maxRetailLeverage ? ` · плечо до 1:${t.maxRetailLeverage}` : ''}
                    </span>
                    {blocked ? <span className="text-negative mt-1 block text-xs">{t.blockerText.join('; ')}</span> : null}
                  </button>
                );
              })}
            </div>
          )}
          {targetOpt && targetOpt.hintText.length ? (
            <Callout tone="warning" title="Подсказки по профилям юрисдикций" className="mt-3">
              <ul className="list-disc space-y-1 pl-4">
                {targetOpt.hintText.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            </Callout>
          ) : null}
        </Step>

        <Step n={2} title="Заявление клиента — тикет поддержки" done={Boolean(ticket && !ticket.usedByTransfer)}>
          <p className="text-muted mb-2 text-xs">
            Только тикеты, первое сообщение которых написал сам клиент (чат кабинета или письмо на адрес поддержки).
            Тикет, открытый оператором, не принимается.
          </p>
          {tickets.length === 0 ? (
            <Callout tone="warning" title="У клиента нет обращения-заявления">
              Перевод возможен только по заявлению клиента в техподдержку. Предлагать перевод нельзя.
            </Callout>
          ) : (
            <div className="space-y-2" role="radiogroup" aria-label="Тикет-заявление">
              {tickets.map((t) => (
                <label
                  key={t.ticketId}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5',
                    t.ticketId === ticketId ? 'border-accent bg-accent/[0.06]' : 'border-border hover:border-border-strong',
                    t.usedByTransfer && 'cursor-not-allowed opacity-70',
                  )}
                >
                  <input
                    type="radio"
                    name="ticketPick"
                    className="mt-1"
                    disabled={Boolean(t.usedByTransfer)}
                    checked={t.ticketId === ticketId}
                    onChange={() => {
                      setTicketId(t.ticketId);
                      setConsentId(t.clientMessages.length === 1 ? t.clientMessages[0]!.id : '');
                      setConsentOk(false);
                    }}
                  />
                  <span className="min-w-0">
                    <span className="text-primary block text-sm font-medium">
                      #{t.number} · {t.subject}
                    </span>
                    <span className="text-muted block text-xs">
                      {new Date(t.createdAt).toLocaleString('ru-RU')} · {CHANNEL[t.originChannel] ?? t.originChannel} · первое сообщение — клиент
                      {t.usedByTransfer ? ` · уже основание перевода ${t.usedByTransfer}` : ''}
                    </span>
                    <span className="text-secondary mt-1 block text-[13px] italic">«{t.firstExcerpt}»</span>
                  </span>
                </label>
              ))}
            </div>
          )}
          {rejected.length ? (
            <p className="text-muted mt-2 text-xs">
              Не подходят:{' '}
              {rejected.map((r) => `#${r.number} (${r.reason === 'openedByOperator' ? 'открыт оператором' : 'без сообщений'})`).join(', ')}.
            </p>
          ) : null}
        </Step>

        <Step n={3} title="Согласие клиента на передачу данных" done={Boolean(consentId && consentOk)}>
          {ticket ? (
            <div className="space-y-3">
              <p className="text-muted text-xs">Выберите сообщение клиента в этом тикете, где он соглашается на передачу данных.</p>
              <div className="space-y-1.5">
                {ticket.clientMessages.map((m) => (
                  <label key={m.id} className="flex cursor-pointer items-start gap-2 text-[13px]">
                    <input
                      type="radio"
                      name="consentPick"
                      className="mt-1"
                      checked={consentId === m.id}
                      onChange={() => setConsentId(m.id)}
                    />
                    <span>
                      <span className="text-muted tabular-nums">{new Date(m.createdAt).toLocaleString('ru-RU')}</span>{' '}
                      <span className="text-secondary italic">«{m.excerpt}»</span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="border-border bg-sunken rounded-md border px-3 py-2.5 text-[13px]">
                <p className="text-secondary">{consentText}</p>
                <p className="text-muted mt-1 text-xs">Версия текста: {consentVersion}</p>
              </div>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <Checkbox checked={consentOk} onChange={(e) => setConsentOk(e.target.checked)} className="mt-0.5 size-4" disabled={!consentId} />
                <span>Согласие клиента в выбранном сообщении соответствует этому тексту</span>
              </label>
            </div>
          ) : (
            <p className="text-muted text-xs">Сначала выберите тикет-заявление.</p>
          )}
        </Step>
      </div>
    </ActionForm>
  );
}
