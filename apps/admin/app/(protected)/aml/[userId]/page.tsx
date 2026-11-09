import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Breadcrumbs,
  Callout,
  CopyButton,
  DescriptionList,
  EmptyState,
  EntityHeader,
  Mono,
  Panel,
  StatusBadge,
  Timeline,
} from '@broker/ui';
import { getAmlCard } from '@/lib/aml/queries';
import { SANCTIONS_LISTS, sanctionsListLabel } from '@/lib/aml/lists';
import { getClientCard } from '@/lib/clients/queries';
import { getOperatorSession } from '@/lib/auth/current';
import { actionLabel } from '@/lib/journal/labels';
import { fmtAge, fmtDate, fmtDateTime } from '@/lib/ui/format';
import { amlKey } from '../../clients/_components/compliance-labels';
import { ScreeningForm } from './ScreeningForm';
import { ClearEscalationForm } from './ClearEscalationForm';

/**
 * AML-сверка клиента `/aml/[userId]` (ADM-14, Р-454 I-5, Р-456 D; концепция §7.4).
 *
 * Сетка 2:1: слева — текущий результат и полная история сверок (из журнала);
 * справа — липкая панель «Зафиксировать результат» (форма с основанием), а при
 * эскалации у администратора — «Опасная зона» со снятием эскалации.
 *
 * Сверку оператор делает ВРУЧНУЮ во внешних источниках; форма фиксирует
 * РЕЗУЛЬТАТ. «Найдено» блокирует клиента автоматически (Р-456 D). Роль-гейт:
 * просмотр и фиксация — operator+admin; снятие эскалации — admin (fail-closed:
 * у оператора панели нет, на сервере роль проверяется повторно).
 */
export const dynamic = 'force-dynamic';

export default async function ClientAmlPage({ params }: { params: { userId: string } }) {
  const [card, operator] = await Promise.all([getAmlCard(params.userId), getOperatorSession()]);
  if (!card) notFound();
  const client = await getClientCard(card.userId);
  const isAdmin = operator?.role === 'admin';
  const escalated = card.status === 'escalated';
  const kycState = client?.state ?? 'unverified';

  return (
    <div className="space-y-5">
      <Breadcrumbs
        linkComponent={Link}
        items={[{ label: 'AML-скрининг', href: '/aml' }, { label: card.fullName }]}
      />

      <EntityHeader
        title={card.fullName}
        initialsFrom={card.fullName}
        tone={card.blocked ? 'negative' : 'default'}
        badges={
          <>
            <StatusBadge status={amlKey(card.status)} />
            <StatusBadge status={kycState} label={kycState === 'verified' ? 'KYC подтверждён' : undefined} />
            {card.blocked ? <StatusBadge status="blocked" /> : null}
          </>
        }
        meta={[
          <a key="email" href={`mailto:${card.email}`} className="hover:text-primary">
            {card.email}
          </a>,
          <span key="id" className="inline-flex items-center gap-1">
            id <Mono value={card.userId} middle={8} className="text-secondary" />
            <CopyButton value={card.userId} label="id клиента" />
          </span>,
          client ? <span key="reg">клиент с {fmtDate(client.registeredAt)}</span> : null,
        ].filter(Boolean)}
        actions={
          <>
            {kycState !== 'unverified' ? (
              <Link
                href={`/kyc/${card.userId}`}
                className="inline-flex h-9 items-center rounded-md border border-border-strong px-3.5 text-sm text-primary hover:bg-primary/5"
              >
                KYC-заявка
              </Link>
            ) : null}
            <Link
              href={`/clients/${card.userId}?tab=compliance`}
              className="inline-flex h-9 items-center rounded-md border border-border-strong px-3.5 text-sm text-primary hover:bg-primary/5"
            >
              Карточка клиента
            </Link>
          </>
        }
        facts={[
          {
            label: 'Последняя сверка',
            value: card.screenedAt ? fmtDate(card.screenedAt) : '—',
            hint: card.screenedAt ? `${fmtAge(card.screenedAt)} назад` : 'не сверялся',
          },
          { label: 'Кто сверял', value: card.screenedByName ?? '—', hint: card.screenedAt ? fmtDateTime(card.screenedAt) : undefined },
          {
            label: 'Списки',
            value: `${card.listsChecked.length} из ${SANCTIONS_LISTS.length}`,
            hint: card.listsChecked.length ? card.listsChecked.map(sanctionsListLabel).join(', ') : 'не отмечены',
          },
          { label: 'Сверок в истории', value: card.history.length, hint: 'из неизменяемого журнала' },
        ]}
      />

      {escalated ? (
        <Callout
          tone="negative"
          title={
            card.blocked
              ? 'Найдено совпадение — эскалация, клиент заблокирован автоматически'
              : 'Найдено совпадение — эскалация'
          }
        >
          {card.blockReason ? <>Основание блокировки: {card.blockReason}. </> : null}
          {isAdmin
            ? 'Снять эскалацию можно после ручной проверки — в «Опасной зоне» справа.'
            : 'Снять эскалацию может только администратор после ручной проверки.'}
        </Callout>
      ) : card.blocked ? (
        <Callout tone="negative" title="Клиент заблокирован">
          {card.blockReason ? <>Основание: {card.blockReason}. </> : null}
          Блокировка не связана с AML-эскалацией и управляется в карточке клиента.
        </Callout>
      ) : card.status === 'unscreened' ? (
        <Callout tone="warning" title="Клиент ещё не сверялся по санкционным спискам">
          Сверьте его во внешних источниках и зафиксируйте результат справа.
        </Callout>
      ) : null}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <Panel title="Текущий результат" actions={<StatusBadge status={amlKey(card.status)} />}>
            <DescriptionList
              columns={2}
              items={[
                {
                  term: 'Последняя сверка',
                  value: card.screenedAt ? fmtDateTime(card.screenedAt) : '—',
                  numeric: true,
                  hint: card.screenedByName ?? undefined,
                },
                {
                  term: 'Проверенные списки',
                  value: card.listsChecked.length ? card.listsChecked.map(sanctionsListLabel).join(', ') : '—',
                },
                { term: 'Основание', value: card.reason ?? '—', wide: true },
              ]}
            />
          </Panel>

          <Panel title="История сверок" count={card.history.length} description="Из неизменяемого журнала, новые сверху">
            {card.history.length === 0 ? (
              <EmptyState
                size="compact"
                title="Сверок ещё не было"
                description="Первая сверка появится здесь после фиксации результата."
              />
            ) : (
              <Timeline
                items={card.history.map((h) => {
                  const a = actionLabel(h.action);
                  return {
                    key: String(h.seq),
                    tone: a.tone,
                    title: h.lists.length ? (
                      <>
                        {a.label}
                        <span className="font-normal text-secondary"> · {h.lists.map(sanctionsListLabel).join(', ')}</span>
                      </>
                    ) : (
                      a.label
                    ),
                    time: fmtDateTime(h.occurredAt),
                    meta: (
                      <>
                        {h.operatorName ?? '—'} · <span className="tabular-nums">seq {h.seq}</span>
                      </>
                    ),
                    body: h.basis ? <>Основание: {h.basis}</> : undefined,
                  };
                })}
              />
            )}
          </Panel>
        </div>

        <aside className="min-w-0 space-y-5 xl:sticky xl:top-20">
          <Panel
            title="Зафиксировать результат"
            description="Сверка — во внешних источниках (OFSI, OFAC, EU, PEP). Здесь — исход и основание."
          >
            <ScreeningForm userId={card.userId} />
          </Panel>
          {isAdmin && escalated ? (
            <Panel
              tone="danger"
              title="Опасная зона"
              description="Только администратор. Снятие эскалации разблокирует клиента."
            >
              <ClearEscalationForm userId={card.userId} />
            </Panel>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
