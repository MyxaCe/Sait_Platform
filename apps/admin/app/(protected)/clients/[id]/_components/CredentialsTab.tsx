import Link from 'next/link';
import { Callout, DescriptionList, EmptyState, Panel, StatusBadge, Timeline, ToneBadge } from '@broker/ui';
import type { MoneyPolicy } from '@broker/money';
import type { ClientJournalEntry } from '@/lib/clients/queries';
import type { CredentialsView } from '@/lib/credentials/queries';
import { CREDENTIAL_ACTION_PREFIX } from '@/lib/credentials/policy';
import { actionLabel } from '@/lib/journal/labels';
import { fmtDateTime } from '@/lib/ui/format';
import { CredentialsForms } from './CredentialsForms';

/**
 * Вкладка «Учётные данные» карточки клиента (функция 3). Видят все роли
 * карточки (в истории только маски); формы — только admin и менеджеру этого
 * клиента (fail-closed: у остальных их нет, не «серые»).
 *
 * История — из неизменяемого журнала: правки `client.credentials.*` и
 * самостоятельные действия клиента со входом (`auth.*`: сброс пароля,
 * подтверждение email) — чтобы видеть картину целиком.
 */

const HOLD_KIND: Record<string, string> = {
  money_flags: 'денежные флаги (финансы)',
  credentials_manual: 'распоряжение менеджера',
  credentials_auto: 'автозаморозка после правки данных',
};

const CAUSE: Record<string, string> = { email: 'смена email', temp_password: 'временный пароль' };

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

function HistoryBody({ e }: { e: ClientJournalEntry }) {
  const p = e.payload;
  const before = str(p.before);
  const after = str(p.after);
  const checklist = Array.isArray(p.checklist) ? (p.checklist as { label: string; checked: boolean }[]) : [];
  const hold = p.autoHold as { until: string; applied: boolean } | null | undefined;
  return (
    <div className="space-y-1">
      {before || after ? (
        <p className="font-mono text-[13px]">
          <span className="text-muted">{before ?? '—'}</span> → <span className="text-primary">{after ?? '—'}</span>
        </p>
      ) : null}
      {str(p.to) ? <p className="text-[13px]">на {String(p.to)}</p> : null}
      {str(p.basis) ? <p className="text-[13px]">Основание: {String(p.basis)}</p> : null}
      <p className="text-muted text-xs">
        {[
          str(p.ticket) ? `тикет №${String(p.ticket)}` : null,
          p.actorAs === 'manager' ? 'менеджер клиента' : p.actorAs === 'admin' ? 'администратор' : null,
          typeof p.sessionsRevoked === 'number' ? `сессий погашено: ${p.sessionsRevoked}` : null,
          str(p.cause) ? `причина: ${CAUSE[String(p.cause)] ?? String(p.cause)}` : null,
          'until' in p ? (str(p.until) ? `до ${fmtDateTime(String(p.until))}` : 'бессрочно') : null,
          hold?.applied ? `вывод заморожен до ${fmtDateTime(hold.until)}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {checklist.length > 0 ? (
        <ul className="text-xs">
          {checklist.map((c) => (
            <li key={c.label} className={c.checked ? 'text-positive' : 'text-muted'}>
              {c.checked ? '✓' : '○'} {c.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function CredentialsTab({
  userId,
  email,
  emailVerifiedAt,
  journal,
  view,
  policy,
  managerName,
  tickets,
}: {
  userId: string;
  email: string;
  emailVerifiedAt: string | null;
  journal: ClientJournalEntry[];
  view: CredentialsView;
  policy: MoneyPolicy;
  managerName: string | null;
  tickets: { number: number; subject: string }[];
}) {
  const history = journal.filter((e) => e.action.startsWith(CREDENTIAL_ACTION_PREFIX) || e.action.startsWith('auth.'));
  const hold = { active: policy.withdrawBanned, kind: policy.withdrawBanKind, until: policy.withdrawBanUntil };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
      <div className="min-w-0 space-y-5">
        <Panel title="Текущие учётные данные">
          <DescriptionList
            columns={1}
            items={[
              {
                term: 'Email',
                value: (
                  <span className="inline-flex flex-wrap items-center gap-2">
                    {email}
                    <ToneBadge tone={emailVerifiedAt ? 'positive' : 'warning'}>{emailVerifiedAt ? 'подтверждён' : 'не подтверждён'}</ToneBadge>
                  </span>
                ),
                hint: emailVerifiedAt ? `подтверждён ${fmtDateTime(emailVerifiedAt)}` : 'письмо подтверждения ждёт клика клиента',
              },
              {
                term: 'Пароль',
                value: view.passwordMustChange ? 'временный — клиент обязан сменить при входе' : 'задан клиентом',
                tone: view.passwordMustChange ? 'warning' : 'default',
                hint: view.passwordMustChange && view.tempPasswordExpiresAt ? `временный действует до ${fmtDateTime(view.tempPasswordExpiresAt)}` : undefined,
              },
              {
                term: 'Вывод средств',
                value: hold.active ? <StatusBadge status="withdraw_banned" /> : 'открыт',
                hint: hold.active
                  ? `${HOLD_KIND[hold.kind ?? 'money_flags']}${hold.until ? ` · до ${fmtDateTime(hold.until)}` : ' · бессрочно'}`
                  : policy.withdrawAllowed
                    ? undefined
                    : 'закрыт по другим причинам — см. «Деньги»',
              },
              { term: 'Менеджер', value: managerName ?? <span className="text-muted">не закреплён</span> },
            ]}
          />
        </Panel>

        <Panel
          title="История изменений учётных данных"
          count={history.length}
          description="Из неизменяемого журнала. Значения до/после — только маскированно."
          actions={
            <Link
              href={`/journal?subjectKind=client&subjectId=${userId}&action=${encodeURIComponent(`${CREDENTIAL_ACTION_PREFIX}*`)}`}
              className="text-accent text-[13px] font-medium hover:underline"
            >
              В журнале →
            </Link>
          }
        >
          {history.length === 0 ? (
            <EmptyState size="compact" title="Учётные данные не менялись" description="Ни менеджер, ни клиент не меняли email и пароль." />
          ) : (
            <Timeline
              items={history.map((e) => {
                const a = actionLabel(e.action);
                return {
                  key: String(e.seq),
                  tone: a.tone,
                  title: a.label,
                  time: fmtDateTime(e.occurredAt),
                  meta: (
                    <>
                      {e.operatorName ?? '—'} · <span className="tabular-nums">seq {e.seq}</span>
                    </>
                  ),
                  body: <HistoryBody e={e} />,
                };
              })}
            />
          )}
        </Panel>
      </div>

      {view.canEdit ? (
        <Panel
          tone="danger"
          title="Правка учётных данных"
          description={`${view.editorAs === 'admin' ? 'Вы — администратор.' : 'Вы — менеджер этого клиента.'} Каждое действие — с основанием, проверкой личности и записью в журнал; клиент получает уведомление.`}
        >
          <CredentialsForms
            userId={userId}
            email={email}
            emailVerified={emailVerifiedAt !== null}
            checklist={view.settings.checklist}
            minChecked={view.settings.minChecked}
            autoHoldEnabled={view.settings.autoHoldEnabled}
            autoHoldHours={view.settings.autoHoldHours}
            tempPasswordHours={view.settings.tempPasswordHours}
            tickets={tickets}
            withdrawals={view.editableWithdrawals}
            hold={hold}
          />
        </Panel>
      ) : (
        <Callout tone="neutral" title="Только просмотр" className="self-start">
          Править email, пароль и адрес вывода может менеджер этого клиента или администратор.
        </Callout>
      )}
    </div>
  );
}
