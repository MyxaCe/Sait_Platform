import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Breadcrumbs,
  Callout,
  CopyButton,
  EmptyState,
  EntityHeader,
  Mono,
  Panel,
  StatusBadge,
  Timeline,
  type StatusTone,
} from '@broker/ui';
import {
  ADDRESS_PROOF_MAX_AGE_DAYS,
  DOC_KIND_LABELS,
  getClientVerificationCard,
  isDocumentOlderThan,
  type KycDocKind,
} from '@/lib/kyc/queries';
import { getClientCard } from '@/lib/clients/queries';
import { getAmlCard } from '@/lib/aml/queries';
import { sourceOfFundsRuleText, sourceOfFundsStatus } from '@/lib/kyc/jurisdiction';
import { isKycOverdue } from '@/lib/kyc/queue-view';
import { actionLabel } from '@/lib/journal/labels';
import { fmtAge, fmtDate, fmtDateTime } from '@/lib/ui/format';
import { CheckList, type CheckItem } from '../../clients/_components/CheckList';
import { AML_SHORT, amlKey } from '../../clients/_components/compliance-labels';
import { DecisionForm } from './DecisionForm';
import { DocumentReview } from './_components/DocumentReview';

/**
 * Решение по заявке KYC `/kyc/[userId]` (ADM-08, Р-451 п.4; концепция §7.4).
 *
 * Сетка 2:1. Слева — материалы: документы с просмотром рядом (каждый просмотр
 * журналируется прежним action-ом), правило «источник средств», история
 * решений и просмотров. Справа — липкая панель «Решение»: статус, итог
 * проверок, форма с основанием (подтвердить — primary; переподача; отклонить —
 * через подтверждение).
 *
 * Решать можно лишь pending-клиента; у остальных состояний формы нет
 * (fail-closed переходами — `decide.ts`). Роль: operator+admin, как раньше.
 * Только представление: чтения — прежние (`getClientVerificationCard`,
 * `getClientCard`, `getAmlCard`), экшены — прежние.
 */
export const dynamic = 'force-dynamic';

const REQUIRED_KINDS: KycDocKind[] = ['identity', 'selfie_liveness', 'address_proof', 'source_of_funds'];

const HISTORY_ACTIONS = new Set([
  'client.verification.verified',
  'client.verification.rejected',
  'client.verification.resubmit_requested',
  'client.document.viewed',
]);

export default async function KycDecisionPage({ params }: { params: { userId: string } }) {
  const card = await getClientVerificationCard(params.userId);
  if (!card) notFound();
  const [client, aml] = await Promise.all([getClientCard(card.userId), getAmlCard(card.userId)]);

  const pending = card.state === 'pending';
  const kinds = new Set(card.documents.map((d) => d.kind));
  const missing = REQUIRED_KINDS.filter((k) => !kinds.has(k));
  const address = card.documents.find((d) => d.kind === 'address_proof');
  const addressStale = address ? isDocumentOlderThan(address.submittedAt, ADDRESS_PROOF_MAX_AGE_DAYS) : false;
  // ADM-11 (Р-454 I-2): сумм депозитов в операторке нет — режим «сумм нет»:
  // отсутствие документа даёт консервативный флаг «проверь вручную».
  const sof = sourceOfFundsStatus(kinds.has('source_of_funds'));
  const amlStatus = aml?.status ?? 'unscreened';
  const blocked = client?.block.blocked ?? false;
  const history = (client?.journal ?? []).filter((e) => HISTORY_ACTIONS.has(e.action));
  const docLabel = (k: KycDocKind) => DOC_KIND_LABELS[k];

  const amlTone: StatusTone = amlStatus === 'clear' ? 'positive' : amlStatus === 'escalated' ? 'negative' : 'warning';
  const checks: CheckItem[] = [
    {
      key: 'docs',
      label: 'Документы',
      value: `${REQUIRED_KINDS.length - missing.length} из ${REQUIRED_KINDS.length}`,
      tone: missing.length === 0 ? 'positive' : 'warning',
      hint: missing.length ? `нет: ${missing.map(docLabel).join(', ').toLowerCase()}` : 'все виды поданы',
    },
    {
      key: 'address',
      label: 'Подтверждение адреса',
      value: !address ? 'не подано' : addressStale ? 'старше 3 мес' : 'свежее',
      tone: !address || addressStale ? 'warning' : 'positive',
      hint: address ? `подано ${fmtDate(address.submittedAt)} · допустимо до 3 мес` : undefined,
    },
    {
      key: 'sof',
      label: 'Источник средств',
      value: sof === 'submitted' ? 'подан' : 'не подан',
      tone: sof === 'submitted' ? 'positive' : 'warning',
      hint: sof === 'submitted' ? undefined : 'проверьте порог вручную',
    },
    {
      key: 'aml',
      label: 'AML-сверка',
      value: AML_SHORT[amlStatus],
      tone: amlTone,
      hint: aml?.screenedAt ? `${fmtDateTime(aml.screenedAt)} · ${aml.screenedByName ?? '—'}` : 'по спискам не сверялся',
    },
    {
      key: 'access',
      label: 'Доступ',
      value: blocked ? 'заблокирован' : 'активен',
      tone: blocked ? 'negative' : 'positive',
    },
  ];

  const lastDecision = (client?.journal ?? []).find((e) => e.action.startsWith('client.verification.'));

  return (
    <div className="space-y-5">
      <Breadcrumbs
        linkComponent={Link}
        items={[{ label: 'Верификация', href: '/kyc' }, { label: card.fullName }]}
      />

      <EntityHeader
        title={card.fullName}
        initialsFrom={card.fullName}
        tone={blocked ? 'negative' : 'default'}
        badges={
          <>
            <StatusBadge status={card.state} label={card.state === 'pending' ? 'KYC на проверке' : card.state === 'verified' ? 'KYC подтверждён' : undefined} />
            <StatusBadge status={amlKey(amlStatus)} />
            {blocked ? <StatusBadge status="blocked" /> : null}
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
          <span key="reg">клиент с {fmtDate(card.registeredAt)}</span>,
        ]}
        actions={
          <>
            <Link
              href={`/aml/${card.userId}`}
              className="inline-flex h-9 items-center rounded-md border border-border-strong px-3.5 text-sm text-primary hover:bg-primary/5"
            >
              AML-сверка
            </Link>
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
            label: pending ? 'В очереди' : 'Состояние с',
            value: pending ? (
              <span className={isKycOverdue(card.updatedAt) ? 'text-warning' : undefined}>{fmtAge(card.updatedAt)}</span>
            ) : (
              fmtDate(card.updatedAt)
            ),
            hint: pending ? `с ${fmtDateTime(card.updatedAt)}` : fmtDateTime(card.updatedAt),
          },
          {
            label: 'Документы',
            value: `${REQUIRED_KINDS.length - missing.length} из ${REQUIRED_KINDS.length}`,
            hint: missing.length ? `не хватает: ${missing.length}` : 'все виды поданы',
          },
          {
            label: 'Последний вход',
            value: client?.lastLoginAt ? fmtDate(client.lastLoginAt) : '—',
            hint: client?.lastLoginAt ? fmtDateTime(client.lastLoginAt) : 'не входил',
          },
          {
            label: 'Активных сессий',
            value: client?.sessions.length ?? 0,
            hint: 'кабинет клиента',
          },
        ]}
      />

      {blocked ? (
        <Callout tone="negative" title="Клиент заблокирован — вход в кабинет и терминал закрыт">
          {client?.block.reason ? <>Основание: {client.block.reason}. </> : null}
          Решение по KYC блокировку не снимает — она управляется отдельно, в карточке клиента.
        </Callout>
      ) : null}
      {amlStatus === 'escalated' ? (
        <Callout tone="negative" title="AML: найдено совпадение, эскалация">
          Перед подтверждением KYC разберите эскалацию на странице{' '}
          <Link href={`/aml/${card.userId}`} className="font-medium underline">
            AML-сверки
          </Link>
          .
        </Callout>
      ) : null}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <Panel
            title="Документы"
            count={card.documents.length}
            description="Просмотр — рядом с решением. Каждое открытие пишется в журнал."
            flush
          >
            {card.documents.length === 0 ? (
              <EmptyState
                size="compact"
                title="Документы не поданы"
                description="Клиент ещё не загрузил ни одного документа. Решение по пустой заявке — запрос переподачи."
              />
            ) : (
              <DocumentReview
                documents={card.documents.map((d) => ({
                  id: d.id,
                  label: DOC_KIND_LABELS[d.kind],
                  contentType: d.contentType,
                  submittedAt: d.submittedAt,
                  submittedText: fmtDateTime(d.submittedAt),
                  flag:
                    d.kind === 'address_proof' && isDocumentOlderThan(d.submittedAt, ADDRESS_PROOF_MAX_AGE_DAYS)
                      ? 'старше 3 мес — нужен свежий'
                      : null,
                }))}
              />
            )}
          </Panel>

          <Panel title="Источник средств" description="Профиль юрисдикции по умолчанию">
            <p className="text-sm text-secondary">{sourceOfFundsRuleText()}</p>
            {sof === 'submitted' ? (
              <Callout tone="positive" className="mt-3">
                Документ «Источник средств» подан.
              </Callout>
            ) : (
              <Callout tone="warning" title="Источник средств не подан" className="mt-3">
                Суммы депозитов здесь не видны (их ведёт терминал) — проверьте вручную, достигает ли
                клиент порога; при необходимости запросите переподачу.
              </Callout>
            )}
          </Panel>

          <Panel title="История заявки" count={history.length} description="Решения и просмотры документов, новые сверху">
            {history.length === 0 ? (
              <EmptyState size="compact" title="Решений и просмотров ещё не было" />
            ) : (
              <Timeline
                items={history.map((e) => {
                  const a = actionLabel(e.action);
                  const basis = typeof e.payload.basis === 'string' ? e.payload.basis : null;
                  const kind = typeof e.payload.kind === 'string' ? (e.payload.kind as KycDocKind) : null;
                  return {
                    key: String(e.seq),
                    tone: a.tone,
                    title: kind && DOC_KIND_LABELS[kind] ? `${a.label}: ${DOC_KIND_LABELS[kind].toLowerCase()}` : a.label,
                    time: fmtDateTime(e.occurredAt),
                    meta: (
                      <>
                        {e.operatorName ?? '—'} · <span className="tabular-nums">seq {e.seq}</span>
                      </>
                    ),
                    body: basis ? <>Основание: {basis}</> : undefined,
                  };
                })}
              />
            )}
          </Panel>
        </div>

        <aside className="min-w-0 space-y-5 xl:sticky xl:top-20">
          <Panel
            title="Решение"
            actions={<StatusBadge status={card.state} />}
          >
            <CheckList items={checks} />
            <div className="mt-4 border-t border-border pt-4">
              {pending ? (
                <DecisionForm userId={card.userId} />
              ) : (
                <div className="space-y-2 text-sm">
                  <p className="text-secondary">
                    Решение уже принято — форма доступна только для заявок «На проверке».
                  </p>
                  {lastDecision ? (
                    <p className="text-xs text-muted">
                      {actionLabel(lastDecision.action).label} · {fmtDateTime(lastDecision.occurredAt)} ·{' '}
                      {lastDecision.operatorName ?? '—'}
                      {typeof lastDecision.payload.basis === 'string' ? (
                        <span className="mt-1 block text-secondary">Основание: {lastDecision.payload.basis}</span>
                      ) : null}
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
