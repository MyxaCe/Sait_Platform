import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  Breadcrumbs,
  Callout,
  DescriptionList,
  EmptyState,
  EntityHeader,
  Money,
  Panel,
  StatusBadge,
  ToneBadge,
  cn,
  statusKeyOf,
  type StatusKey,
} from '@broker/ui';
import {
  allowedTransitions,
  getTicketForOperator,
  listAssignableOperators,
  listTemplates,
  loadClientContext,
  loadSupportSettings,
  readMailChannelState,
  recordContextView,
  renderTemplate,
  supportAccess,
  templateVars,
  type ClientContext,
  type MessageView,
  type TicketView,
} from '@broker/support';
import { LOGIN_PATH } from '@/lib/auth/constants';
import { isNarrowRole } from '@/lib/auth/role-scope';
import { getPool } from '@/lib/db';
import { assignAction, linkClientAction, replyAction, requeueMailAction, statusAction } from '@/lib/support/actions';
import { CHANNEL_LABEL, STATUS_ACTION, STATUS_KEY } from '@/lib/support/labels';
import { supportActor, supportPool } from '@/lib/support/runtime';
import { fmtAge, fmtDateTime } from '@/lib/ui/format';
import { ROLE_LABEL } from '../../operators/_components/roles';
import { AutoRefresh } from '../_components/AutoRefresh';
import { MailStatusCallout } from '../_components/MailStatus';
import { AssignForm, Composer, LinkClientForm, RequeueButton, SpamForm, StatusForm } from '../_components/TicketForms';

/**
 * Экран обращения (концепция §7.4: слева материалы — переписка и ответ,
 * справа — контекст клиента и решения). Контекст собирается на сервере ПО
 * РОЛИ (`loadClientContext`): у оператора поддержки нет сумм, балансов,
 * адресов и KYC-документов — их не выбирают запросы, а не прячет вёрстка.
 * Просмотр контекста журналируется (не чаще раза в 30 мин).
 */
export const dynamic = 'force-dynamic';

const KYC_KEY: Record<string, StatusKey> = {
  unverified: 'unverified',
  pending: 'pending',
  verified: 'verified',
  rejected: 'rejected',
  resubmit_requested: 'resubmit_requested',
};
const AML_KEY: Record<string, StatusKey> = { unscreened: 'aml_unscreened', clear: 'aml_clear', escalated: 'aml_escalated' };

function fmtSize(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`;
}

function MessageItem({ m, ticketNumber }: { m: MessageView; ticketNumber: number }) {
  const internal = m.visibility === 'internal';
  const fromClient = m.authorKind === 'client';
  const auto = m.authorKind === 'autoreply' || m.authorKind === 'system';
  const who = fromClient ? m.authorName ?? 'Клиент' : auto ? 'Автоответ' : m.authorName ?? 'Оператор';
  return (
    <li
      className={cn(
        'rounded-md border px-3.5 py-3',
        internal
          ? 'border-warning/40 bg-warning/[0.06]'
          : fromClient
            ? 'border-border bg-card'
            : auto
              ? 'border-border border-dashed bg-transparent'
              : 'border-accent/25 bg-accent/[0.05] ml-6',
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[13px]">
          <span className={cn('font-medium', auto ? 'text-secondary' : 'text-primary')}>{who}</span>
          <span className="text-muted">
            {' · '}
            {internal ? 'внутренняя заметка — клиент не видит' : fromClient ? CHANNEL_LABEL[m.channel] : m.channel === 'email' ? 'письмом' : 'в чат'}
            {m.templateKey ? ` · шаблон ${m.templateKey}` : ''}
          </span>
        </p>
        <time className="text-muted text-xs tabular-nums" dateTime={m.createdAt}>
          {fmtDateTime(m.createdAt)}
        </time>
      </div>
      <p className={cn('mt-1.5 whitespace-pre-wrap break-words text-sm', auto ? 'text-secondary' : 'text-primary')}>{m.body}</p>
      {m.attachments.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-2">
          {m.attachments.map((a) => (
            <li key={a.id}>
              <a
                href={`/api/support/attachments/${a.id}`}
                target="_blank"
                rel="noreferrer"
                className="border-border-strong text-accent hover:bg-primary/5 inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs"
              >
                <span aria-hidden>📎</span> {a.filename} <span className="text-muted">{fmtSize(a.sizeBytes)}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {m.delivery ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <StatusBadge status={(statusKeyOf(`mail_${m.delivery.status}`) ?? 'mail_queued') as StatusKey} />
          {m.delivery.sentAt ? <span className="text-muted tabular-nums">{fmtDateTime(m.delivery.sentAt)}</span> : null}
          {m.delivery.attempts > 1 ? <span className="text-muted">попыток: {m.delivery.attempts}</span> : null}
          {m.delivery.lastError && m.delivery.status !== 'sent' ? <span className="text-negative">{m.delivery.lastError}</span> : null}
          {m.delivery.status === 'failed' ? <RequeueButton action={requeueMailAction} outboundId={m.delivery.outboundId} ticketNumber={ticketNumber} /> : null}
        </div>
      ) : null}
    </li>
  );
}

function ContextPanel({ ctx, canOpenCard }: { ctx: ClientContext; canOpenCard: boolean }) {
  const restricted = [ctx.blocked && 'blocked', ctx.frozen && 'frozen', ctx.withdrawBanned && 'withdraw_banned'].filter(Boolean) as StatusKey[];
  return (
    <Panel
      title="Контекст клиента"
      description={ctx.redacted.money ? 'Суммы, балансы и адреса скрыты ролью' : undefined}
      actions={
        canOpenCard ? (
          <Link href={`/clients/${ctx.userId}`} className="text-accent text-[13px] font-medium hover:underline">
            Карточка →
          </Link>
        ) : null
      }
    >
      <div className="space-y-4">
        <div>
          <p className="text-primary text-sm font-semibold">{ctx.fullName}</p>
          <p className="text-muted text-xs">
            {ctx.email} · {ctx.emailVerified ? 'email подтверждён' : 'email не подтверждён'}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <StatusBadge status={KYC_KEY[ctx.kycState] ?? 'unverified'} label={ctx.kycState === 'verified' ? 'KYC подтверждён' : undefined} />
          <StatusBadge status={AML_KEY[ctx.amlStatus] ?? 'aml_unscreened'} />
          {restricted.map((s) => (
            <StatusBadge key={s} status={s} />
          ))}
        </div>
        {ctx.blocked && ctx.blockReason ? (
          <Callout tone="negative">Блокировка: {ctx.blockReason}</Callout>
        ) : null}
        <DescriptionList
          columns={2}
          items={[
            { term: 'Клиент с', value: fmtDateTime(ctx.registeredAt).slice(0, 10) },
            { term: 'Последний вход', value: ctx.lastLoginAt ? fmtDateTime(ctx.lastLoginAt) : 'никогда' },
            { term: 'Реальный счёт', value: ctx.hasRealAccount ? 'открыт' : 'не открыт' },
            ctx.redacted.money
              ? { term: 'Баланс', value: <span className="text-muted">скрыт ролью</span> }
              : { term: `Баланс, ${ctx.realCurrency ?? 'USDT'}`, value: <Money minor={ctx.realBalanceMinor ?? null} currency={ctx.realCurrency ?? 'USDT'} hideCurrency />, numeric: true },
            { term: 'Язык', value: ctx.locale === 'en' ? 'английский' : 'русский' },
            ctx.redacted.kycDocuments
              ? { term: 'KYC-документы', value: <span className="text-muted">скрыты ролью</span> }
              : { term: 'KYC-документы', value: String(ctx.kycDocumentCount ?? 0) },
          ]}
        />
        <div>
          <p className="text-muted mb-1.5 text-xs">Последние операции с деньгами</p>
          {ctx.recentMoney.length === 0 ? (
            <p className="text-muted text-[13px]">Пополнений и выводов не было.</p>
          ) : (
            <ul className="divide-border divide-y text-[13px]">
              {ctx.recentMoney.map((o, i) => {
                const key = statusKeyOf(`${o.kind}_${o.status}`);
                return (
                  <li key={i} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="text-secondary w-16 shrink-0">{o.kind === 'deposit' ? '↓ Ввод' : '↑ Вывод'}</span>
                    {key ? <StatusBadge status={key} /> : <ToneBadge tone="neutral">{o.status}</ToneBadge>}
                    {o.amountMinor !== undefined ? (
                      <Money minor={o.amountMinor} currency="USDT" className="ml-auto" />
                    ) : (
                      <span className="text-muted ml-auto text-xs">сумма скрыта</span>
                    )}
                    <span className="text-muted w-[6.5rem] shrink-0 text-right text-xs tabular-nums">{fmtDateTime(o.at).slice(0, 10)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}

function headerFacts(t: TicketView) {
  const due = t.firstRespondedAt ? null : t.firstResponseDueAt;
  const overdue = due !== null && new Date(due) < new Date() && (t.status === 'new' || t.status === 'open');
  return [
    { label: 'Канал', value: CHANNEL_LABEL[t.originChannel], hint: t.replyChannel === 'email' ? 'ответ — письмом' : 'ответ — в чат кабинета' },
    { label: 'Создано', value: fmtAge(t.createdAt), hint: fmtDateTime(t.createdAt) },
    {
      label: 'Первый ответ',
      value: t.firstRespondedAt ? 'дан' : overdue ? <span className="text-negative">просрочен</span> : 'ждёт',
      hint: t.firstRespondedAt ? fmtDateTime(t.firstRespondedAt) : due ? `срок ${fmtDateTime(due)}` : '—',
    },
    { label: 'Назначен', value: t.assigneeName ?? '—', hint: t.assigneeName ? 'ответственный' : 'никто не взял' },
    {
      label: 'Оценка клиента',
      value: t.csatScore ? `${t.csatScore} из 5` : '—',
      hint: t.csatComment ? `«${t.csatComment.slice(0, 40)}»` : t.status === 'resolved' ? 'ждём оценку' : 'после «решено»',
    },
  ];
}

export default async function TicketPage({ params }: { params: { number: string } }) {
  const actor = await supportActor();
  if (!actor) redirect(LOGIN_PATH);
  const db = getPool();
  const ticket = await getTicketForOperator(db, actor, params.number);
  if (!ticket) notFound();

  const [settings, operators, templates, mail, ctx] = await Promise.all([
    loadSupportSettings(db),
    listAssignableOperators(db),
    listTemplates(db, { activeOnly: true, locale: ticket.locale }),
    readMailChannelState(db),
    ticket.userId ? loadClientContext(db, actor.role, ticket.userId) : Promise.resolve(null),
  ]);
  if (ctx) await recordContextView(supportPool(), actor, ticket.id, ctx.userId);

  const vars = templateVars(settings, { number: ticket.number, subject: ticket.subject, contactName: ticket.clientName ?? ticket.contactName, locale: ticket.locale }, actor.displayName);
  const templateOptions = templates.map((t) => ({ key: t.key, title: t.title, text: renderTemplate(t.body, vars) }));
  const closed = ticket.status === 'closed' || ticket.status === 'spam';
  const transitions = allowedTransitions(ticket.status)
    .filter((s) => s !== 'spam')
    .map((s) => ({ to: s, label: STATUS_ACTION[s] ?? s, primary: s === 'resolved' }));
  const lastClientAt = [...ticket.messages].reverse().find((m) => m.authorKind === 'client')?.createdAt ?? ticket.createdAt;

  return (
    <div className="space-y-5">
      <AutoRefresh seconds={5} />
      <Breadcrumbs linkComponent={Link} items={[{ label: 'Поддержка', href: '/support' }, { label: `#${ticket.number}` }]} />
      <EntityHeader
        title={
          <>
            <span className="text-muted tabular-nums">#{ticket.number}</span> {ticket.subject}
          </>
        }
        initialsFrom={ticket.clientName ?? ticket.contactName ?? ticket.contactEmail}
        tone={ticket.status === 'spam' ? 'negative' : 'default'}
        badges={
          <>
            <StatusBadge status={STATUS_KEY[ticket.status]} />
            {ticket.userId ? <ToneBadge tone="neutral">клиент платформы</ToneBadge> : <ToneBadge tone="info">гость</ToneBadge>}
            {ticket.sourceLeadId ? <ToneBadge tone="neutral">восстановлено из формы контактов</ToneBadge> : null}
          </>
        }
        meta={[
          <span key="who">{ticket.clientName ?? ticket.contactName ?? 'Без имени'}</span>,
          <a key="email" href={`mailto:${ticket.contactEmail}`} className="hover:text-primary">
            {ticket.contactEmail}
          </a>,
          <span key="lang">язык: {ticket.locale === 'en' ? 'английский' : 'русский'}</span>,
          <span key="last">последнее от клиента: {fmtDateTime(lastClientAt)}</span>,
        ]}
        facts={headerFacts(ticket)}
      />

      {ticket.replyChannel === 'email' ? <MailStatusCallout state={mail} emailEnabled={settings.channels.email} isAdmin={supportAccess.managesSettings(actor.role)} compact /> : null}
      {ticket.acks.some((a) => a.status === 'failed') ? (
        <Callout tone="warning">Письмо-подтверждение клиенту не доставлено: {ticket.acks.find((a) => a.status === 'failed')?.lastError}</Callout>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <Panel title="Переписка" count={ticket.messages.length} description="Новые снизу · обновляется каждые 5 с">
            {ticket.messages.length === 0 ? (
              <EmptyState size="compact" title="Сообщений нет" />
            ) : (
              <ol className="space-y-3">
                {ticket.messages.map((m) => (
                  <MessageItem key={m.id} m={m} ticketNumber={ticket.number} />
                ))}
              </ol>
            )}
          </Panel>
          {closed ? (
            <Callout tone="neutral" title={ticket.status === 'spam' ? 'Обращение помечено как спам' : 'Обращение закрыто'}>
              Ответить нельзя, пока обращение не вернут в работу (справа, «Статус»). Внутренняя заметка доступна.
            </Callout>
          ) : null}
          <Composer
            action={replyAction}
            ticketId={ticket.id}
            ticketNumber={ticket.number}
            replyChannel={ticket.replyChannel}
            canReply={!closed}
            templates={templateOptions}
            contactEmail={ticket.contactEmail}
          />
        </div>

        <aside className="min-w-0 space-y-5">
          {ctx ? (
            <ContextPanel ctx={ctx} canOpenCard={!isNarrowRole(actor.role)} />
          ) : (
            <Panel title="Контекст клиента">
              <div className="space-y-3">
                <p className="text-secondary text-sm">
                  Гость: обращение не связано с клиентом платформы. Ответ уходит письмом на {ticket.contactEmail}.
                </p>
                {ticket.suggestedClients.length > 0 ? (
                  <>
                    <Callout tone="info" title="Найден клиент с тем же email">
                      Склеить можно только вручную, с основанием — действие пишется в журнал.
                    </Callout>
                    <LinkClientForm action={linkClientAction} ticketId={ticket.id} ticketNumber={ticket.number} candidates={ticket.suggestedClients} />
                  </>
                ) : (
                  <p className="text-muted text-xs">Клиента с таким email нет.</p>
                )}
              </div>
            </Panel>
          )}

          <Panel title="Назначение">
            <AssignForm
              action={assignAction}
              ticketId={ticket.id}
              ticketNumber={ticket.number}
              current={ticket.assigneeId}
              selfId={actor.operatorId}
              operators={operators.map((o) => ({ id: o.id, name: o.name, roleLabel: ROLE_LABEL[o.role] ?? o.role }))}
            />
          </Panel>

          <Panel
            title="Статус"
            description={
              ticket.status === 'resolved' && ticket.resolvedAt
                ? `Решено ${fmtDateTime(ticket.resolvedAt)}; закроется само через ${settings.autoCloseDays} дн тишины`
                : undefined
            }
          >
            <StatusForm action={statusAction} ticketId={ticket.id} ticketNumber={ticket.number} options={transitions} />
          </Panel>

          {ticket.status !== 'spam' ? (
            <Panel title="Опасная зона" tone="danger">
              <SpamForm action={statusAction} ticketId={ticket.id} ticketNumber={ticket.number} email={ticket.contactEmail} />
            </Panel>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
