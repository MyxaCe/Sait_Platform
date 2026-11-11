import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Breadcrumbs,
  Callout,
  CopyButton,
  DataTable,
  DescriptionList,
  EmptyState,
  EntityHeader,
  Mono,
  Money,
  Panel,
  StatusBadge,
  Tabs,
  Timeline,
  ToneBadge,
  statusKeyOf,
  type DataTableColumn,
  type StatusKey,
} from '@broker/ui';
import { getClientCard, type ClientJournalEntry } from '@/lib/clients/queries';
import { DOC_KIND_LABELS } from '@/lib/clients/verification-state';
import { getOperatorSession } from '@/lib/auth/current';
import { JournalFeed } from './_components/JournalFeed';
import { ViewDocumentButton } from './_components/ViewDocumentButton';
import { canAccessSection, canViewKycDocuments } from '@/components/shell/sections';
import { BlockPanel } from './_components/BlockPanel';
import { AccountStats, TradingSection, type LiveAccount } from './_components/TradingSection';
import { MoneyFlagsPanel } from './_components/MoneyFlagsPanel';
import { getClientTrading } from '@/lib/clients/trading';
import { loadMoneyPolicyInputs, computeMoneyPolicy, type MoneyPolicy } from '@broker/money';
import { canOperateMoney, moneyPool, terminalReader } from '@/lib/crypto/runtime';
import {
  listClientDeposits,
  listClientWithdrawals,
  type DepositRowView,
  type WithdrawalRowView,
} from '@/lib/crypto/queries';
import { DEBIT_STATE, DEPOSIT_REJECT, POLICY_REASON } from '@/lib/crypto/labels';
import { getAmlCard } from '@/lib/aml/queries';
import { sanctionsListLabel } from '@/lib/aml/lists';
import { fmtDate, fmtDateTime } from '@/lib/ui/format';
import { actionLabel } from '@/lib/journal/labels';
import { TronRef } from '../../_money/tron';
// ── Поддержка (ветка demo-support) ──
import { listClientTickets } from '@broker/support';
import { getPool } from '@/lib/db';
import { SupportTab } from './_components/SupportTab';
// ── Менеджеры клиентов (ветка admin-managers) ──
import { getClientManager, listClientManagers } from '@/lib/managers/queries';
import { canAssignManagers } from '@/lib/managers/policy';
import { AssignManagerForm } from '../_components/managers/AssignManagerForm';
// ── Учётные данные клиента (ветка admin-credentials) ──
import { getCredentialsView } from '@/lib/credentials/queries';
import { CredentialsTab } from './_components/CredentialsTab';

/**
 * Карточка клиента `/clients/[id]` (ADM-02, §3.2) — ЭТАЛОННЫЙ экран редизайна
 * (концепция §7.2 «страница-карточка»). Шапка сущности с ключевыми цифрами →
 * баннеры ограничений → вкладки (`?tab=`): Обзор · Торговля · Деньги · KYC и
 * AML · Доступ · Журнал. Вкладки — ссылки (работают без JS, переживают F5).
 *
 * Данные и действия — прежние: проекция торговли, политика денег, живые цифры
 * терминала (null — не ответил), депозиты/выводы, AML-карточка (только чтение),
 * журнал по субъекту. Формы — существующие server actions без изменений.
 *
 * Роль-гейт (fail-closed, недоступное НЕ отрисовано): просмотр — operator+admin
 * (+ finance_operator через деньги); блокировка/сессии — только admin;
 * денежные флаги — admin и finance_operator.
 */
export const dynamic = 'force-dynamic';

const TAB_KEYS = ['overview', 'trading', 'money', 'compliance', 'access', 'credentials', 'support', 'journal'] as const;
type TabKey = (typeof TAB_KEYS)[number];

function asTab(v: string | undefined): TabKey {
  return (TAB_KEYS as readonly string[]).includes(v ?? '') ? (v as TabKey) : 'overview';
}

const LOCALE_LABEL: Record<string, string> = { ru: 'русский', en: 'английский' };

const AML_KEY: Record<string, StatusKey> = {
  unscreened: 'aml_unscreened',
  clear: 'aml_clear',
  escalated: 'aml_escalated',
};

/* ─── Деньги: единая лента депозитов и выводов ───────────────────────── */

interface MoneyRow {
  id: string;
  kind: 'deposit' | 'withdrawal';
  status: StatusKey | undefined;
  rawStatus: string;
  amountMinor: number | null;
  ref: string | null;
  refKind: 'tx' | 'address';
  note: string | null;
  at: string;
}

function toMoneyRows(deposits: DepositRowView[], withdrawals: WithdrawalRowView[]): MoneyRow[] {
  const rows: MoneyRow[] = [
    ...deposits.map((d) => ({
      id: `d-${d.id}`,
      kind: 'deposit' as const,
      status: statusKeyOf(`deposit_${d.status}`),
      rawStatus: d.status,
      amountMinor: d.amountMinor,
      ref: d.txHash,
      refKind: 'tx' as const,
      note: d.rejectReason ? (DEPOSIT_REJECT[d.rejectReason] ?? d.rejectReason) : null,
      at: d.claimedAt,
    })),
    ...withdrawals.map((w) => ({
      id: `w-${w.id}`,
      kind: 'withdrawal' as const,
      status: statusKeyOf(`withdrawal_${w.status}`),
      rawStatus: w.status,
      amountMinor: -w.amountMinor,
      ref: w.toAddress,
      refKind: 'address' as const,
      note: w.rejectReason ?? w.reviewReason ?? (w.status === 'requested' ? (DEBIT_STATE[w.debitState] ?? null) : null),
      at: w.requestedAt,
    })),
  ];
  return rows.sort((a, b) => b.at.localeCompare(a.at));
}

const MONEY_COLUMNS: DataTableColumn<MoneyRow>[] = [
  { key: 'at', header: 'Дата', numeric: true, align: 'left', width: '10rem', cell: (r) => fmtDateTime(r.at) },
  {
    key: 'kind',
    header: 'Операция',
    width: '8rem',
    cell: (r) => (
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className={r.kind === 'deposit' ? 'text-positive' : 'text-secondary'}>
          {r.kind === 'deposit' ? '↓' : '↑'}
        </span>
        {r.kind === 'deposit' ? 'Ввод' : 'Вывод'}
      </span>
    ),
  },
  {
    key: 'status',
    header: 'Статус',
    width: '9.5rem',
    cell: (r) => (r.status ? <StatusBadge status={r.status} /> : <ToneBadge tone="neutral">{r.rawStatus}</ToneBadge>),
  },
  {
    key: 'ref',
    header: 'Хэш / адрес',
    cell: (r) =>
      r.ref ? (
        <span className="inline-flex min-w-0 items-center gap-1">
          <span className="text-muted">{r.refKind === 'tx' ? 'tx' : 'на'}</span>
          <TronRef kind={r.refKind === 'tx' ? 'tx' : 'address'} value={r.ref} middle={8} />
        </span>
      ) : (
        '—'
      ),
  },
  { key: 'note', header: 'Примечание', className: 'min-w-[14rem]', cell: (r) => <span className="text-xs text-muted">{r.note ?? ''}</span> },
  {
    key: 'amount',
    header: 'Сумма',
    numeric: true,
    width: '10rem',
    cell: (r) =>
      r.amountMinor === null ? (
        <span className="text-muted">—</span>
      ) : (
        <Money
          minor={r.amountMinor}
          currency="USDT"
          signed
          className={r.rawStatus === 'rejected' || r.rawStatus === 'cancelled' ? 'text-muted line-through' : undefined}
        />
      ),
  },
];

/* ─── Правила ввода/вывода ─────────────────────────────────────────── */

const SOURCE: Record<string, string> = { platform: 'из настроек платформы', client: 'индивидуально' };

function PolicySummary({ policy }: { policy: MoneyPolicy }) {
  const reasons = (list: string[]) => list.map((r) => POLICY_REASON[r] ?? r).join(', ');
  return (
    <DescriptionList
      columns={2}
      items={[
        {
          term: 'Ввод',
          value: policy.depositAllowed ? 'Разрешён' : `Закрыт: ${reasons(policy.depositReasons)}`,
          tone: policy.depositAllowed ? 'positive' : 'negative',
        },
        {
          term: 'Вывод',
          value: policy.withdrawAllowed ? 'Разрешён' : `Закрыт: ${reasons(policy.withdrawReasons)}`,
          tone: policy.withdrawAllowed ? 'positive' : 'negative',
        },
        { term: 'Ввод только после KYC', value: policy.depositKyc.required ? 'Да' : 'Нет', hint: SOURCE[policy.depositKyc.source] },
        { term: 'Вывод только после KYC', value: policy.withdrawKyc.required ? 'Да' : 'Нет', hint: SOURCE[policy.withdrawKyc.source] },
        { term: 'Заморозка счёта', value: policy.frozen ? 'Включена' : 'Нет', tone: policy.frozen ? 'negative' : 'default', hint: 'индивидуально' },
        { term: 'Запрет вывода', value: policy.withdrawBanned ? 'Включён' : 'Нет', tone: policy.withdrawBanned ? 'negative' : 'default', hint: 'индивидуально' },
        {
          term: 'Торговля на реальном счёте',
          value: policy.realTradingAllowed ? 'Доступна' : 'Закрыта',
          tone: policy.realTradingAllowed ? 'default' : 'negative',
        },
        { term: 'KYC', value: policy.kycVerified ? 'Подтверждён' : 'Не подтверждён', tone: policy.kycVerified ? 'default' : 'warning' },
      ]}
    />
  );
}

/* ─── Верификация ──────────────────────────────────────────────────── */

const VERIFICATION_ACTIONS = new Set([
  'client.verification.verified',
  'client.verification.rejected',
  'client.verification.resubmit_requested',
]);

function VerificationTimeline({ journal }: { journal: ClientJournalEntry[] }) {
  const transitions = journal.filter((e) => VERIFICATION_ACTIONS.has(e.action));
  if (transitions.length === 0) {
    return <EmptyState size="compact" title="Переходов состояния пока не было" />;
  }
  return (
    <Timeline
      items={transitions.map((e) => {
        const a = actionLabel(e.action);
        const basis = typeof e.payload.basis === 'string' ? e.payload.basis : null;
        return {
          key: String(e.seq),
          tone: a.tone,
          title: a.label,
          time: fmtDateTime(e.occurredAt),
          meta: e.operatorName ?? '—',
          body: basis ?? undefined,
        };
      })}
    />
  );
}

/* ─── Страница ─────────────────────────────────────────────────────── */

export default async function ClientCardPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { tab?: string };
}) {
  const [card, operator] = await Promise.all([getClientCard(params.id), getOperatorSession()]);
  if (!card) notFound();
  const tab = asTab(searchParams.tab);

  // Проекция торговли — после проверки, что клиент есть (UUID уже валиден).
  // Демо и реальный счёт разделены (09.11): показываем раздельно.
  const [demo, real, policyInputs, live, deposits, withdrawals, aml] = await Promise.all([
    getClientTrading(card.userId, undefined, 'demo'),
    getClientTrading(card.userId, undefined, 'real'),
    loadMoneyPolicyInputs(moneyPool(), card.userId),
    terminalReader()
      .accounts(card.userId)
      .catch(() => ({ state: 'unavailable' as const, reason: 'network' as const })),
    listClientDeposits(card.userId),
    listClientWithdrawals(card.userId),
    getAmlCard(card.userId),
  ]);
  const policy = computeMoneyPolicy(policyInputs);
  const supportTickets = await listClientTickets(getPool(), card.userId, card.email);
  const supportAwaiting = supportTickets.filter((t) => t.status === 'new' || t.status === 'open').length;
  // ── Менеджер клиента: видят все роли карточки, меняет только admin. ──
  const canAssignManager = canAssignManagers(operator?.role);
  const [manager, managerChoices] = await Promise.all([
    getClientManager(card.userId),
    canAssignManager ? listClientManagers() : Promise.resolve([]),
  ]);
  const managerIsMe = manager !== null && manager.managerId === operator?.operatorId;
  // ── Учётные данные: права зрителя (admin / менеджер этого клиента) — из базы. ──
  const credentials = await getCredentialsView(moneyPool(), {
    userId: card.userId,
    operatorId: operator?.operatorId ?? '00000000-0000-0000-0000-000000000000',
    role: operator?.role,
  });
  const liveOf = (kind: 'demo' | 'real'): LiveAccount | null => {
    if (live.state !== 'ok') return null;
    const a = live.accounts.find((x) => x.kind === kind);
    return a
      ? { equityMinor: a.equityMinor, freeMarginMinor: a.freeMarginMinor, tradingFrozen: a.tradingFrozen, opened: a.opened }
      : { equityMinor: null, freeMarginMinor: null, tradingFrozen: false, opened: false };
  };
  const liveReal = liveOf('real');
  const canMoney = canOperateMoney(operator?.role);
  const isAdmin = operator?.role === 'admin';
  // KYC-документы и переходы в KYC/AML — только ролям этих разделов (матрица
  // sections.ts). finance_operator видит статус верификации, но не документы.
  const canDocs = canViewKycDocuments(operator?.role);
  const canKyc = canAccessSection(operator?.role, 'kyc');
  const canAml = canAccessSection(operator?.role, 'aml');

  const moneyRows = toMoneyRows(deposits, withdrawals);
  const depositedMinor = deposits.filter((d) => d.status === 'credited').reduce((s, d) => s + (d.amountMinor ?? 0), 0);
  const withdrawnMinor = withdrawals.filter((w) => w.status === 'settled').reduce((s, w) => s + w.amountMinor, 0);
  const moneyPending = withdrawals.filter((w) => w.status === 'requested' || w.status === 'needs_review').length;
  const amlStatus = aml?.status ?? 'unscreened';
  const realCurrency = real.account?.currency ?? 'USDT';

  const tabHref = (key: TabKey) => (key === 'overview' ? `/clients/${card.userId}` : `/clients/${card.userId}?tab=${key}`);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        linkComponent={Link}
        items={[{ label: 'Клиенты', href: '/clients' }, { label: card.fullName }]}
      />

      <EntityHeader
        title={card.fullName}
        initialsFrom={card.fullName}
        tone={card.block.blocked ? 'negative' : 'default'}
        badges={
          <>
            <StatusBadge status={card.state} label={card.state === 'verified' ? 'KYC подтверждён' : undefined} />
            <StatusBadge status={AML_KEY[amlStatus] ?? 'aml_unscreened'} />
            {card.block.blocked ? <StatusBadge status="blocked" /> : null}
            {policy.frozen ? <StatusBadge status="frozen" /> : null}
            {policy.withdrawBanned ? <StatusBadge status="withdraw_banned" /> : null}
          </>
        }
        meta={[
          <a key="email" href={`mailto:${card.email}`} className="hover:text-primary">
            {card.email}
          </a>,
          <span key="id" className="inline-flex items-center gap-1">
            id <Mono value={card.userId} className="text-secondary" />
            <CopyButton value={card.userId} label="id клиента" />
          </span>,
          <span key="reg">клиент с {fmtDate(card.registeredAt)}</span>,
          <span key="login">вход {card.lastLoginAt ? fmtDateTime(card.lastLoginAt) : 'никогда'}</span>,
          <span key="loc">язык: {LOCALE_LABEL[card.locale] ?? card.locale}</span>,
          <span key="mgr">
            менеджер:{' '}
            {manager ? (
              <span className="text-primary">{managerIsMe ? `${manager.managerName} (вы)` : manager.managerName}</span>
            ) : (
              'не закреплён'
            )}
          </span>,
        ]}
        actions={
          <>
            {canAml ? (
              <Link
                href={`/aml/${card.userId}`}
                className="inline-flex h-9 items-center rounded-md border border-border-strong px-3.5 text-sm text-primary hover:bg-primary/5"
              >
                AML-сверка
              </Link>
            ) : null}
            {isAdmin ? (
              <Link
                href={tabHref('access')}
                className="inline-flex h-9 items-center rounded-md border border-negative/40 px-3.5 text-sm text-negative hover:bg-negative/10"
              >
                {card.block.blocked ? 'Разблокировать…' : 'Заблокировать…'}
              </Link>
            ) : null}
          </>
        }
        facts={[
          {
            label: `Реальный счёт, ${realCurrency}`,
            value: <Money minor={real.account?.balanceCents ?? null} currency={realCurrency} hideCurrency />,
            hint: real.account ? 'баланс по проекции' : 'зачислений не было',
          },
          {
            label: 'Equity',
            value: <Money minor={liveReal?.opened ? liveReal.equityMinor : null} currency={realCurrency} hideCurrency />,
            hint: liveReal ? (liveReal.opened ? 'терминал, сейчас' : 'счёт в терминале не открыт') : 'терминал недоступен',
          },
          {
            label: 'Свободная маржа',
            value: <Money minor={liveReal?.opened ? liveReal.freeMarginMinor : null} currency={realCurrency} hideCurrency />,
            hint: liveReal?.opened ? 'терминал, сейчас' : '—',
          },
          {
            label: 'Внесено, USDT',
            value: <Money minor={depositedMinor} currency="USDT" hideCurrency />,
            hint: `зачислено депозитов: ${deposits.filter((d) => d.status === 'credited').length}`,
          },
          {
            label: 'Выведено, USDT',
            value: <Money minor={withdrawnMinor} currency="USDT" hideCurrency />,
            hint: moneyPending ? `ждут решения: ${moneyPending}` : 'нет заявок в работе',
          },
        ]}
      />

      {card.block.blocked ? (
        <Callout tone="negative" title="Клиент заблокирован — вход в кабинет и терминал закрыт">
          {card.block.reason ? <>Основание: {card.block.reason}. </> : null}
          {card.block.blockedByName ? <>Кто: {card.block.blockedByName}. </> : null}
          {card.block.updatedAt ? <span className="tabular-nums">Когда: {fmtDateTime(card.block.updatedAt)}.</span> : null}
        </Callout>
      ) : null}
      {policy.frozen || policy.withdrawBanned ? (
        <Callout tone="warning" title={policy.frozen ? 'Реальный счёт заморожен' : 'Вывод средств запрещён'}>
          {policy.frozen
            ? 'Торговля и вывод на реальном счёте закрыты; закрытие позиций работает. Снять — во вкладке «Деньги».'
            : policy.withdrawBanKind === 'credentials_manual' || policy.withdrawBanKind === 'credentials_auto'
              ? `Заявки на вывод не принимаются${policy.withdrawBanUntil ? ` до ${fmtDateTime(policy.withdrawBanUntil)}` : ''} — заморозка после правки учётных данных. Снять — во вкладке «Учётные данные».`
              : 'Заявки на вывод не принимаются. Снять — во вкладке «Деньги».'}
        </Callout>
      ) : null}

      <Tabs
        linkComponent={Link}
        active={tab}
        aria-label="Разделы карточки клиента"
        items={[
          { key: 'overview', label: 'Обзор', href: tabHref('overview') },
          { key: 'trading', label: 'Торговля', href: tabHref('trading'), count: real.positions.length + demo.positions.length },
          {
            key: 'money',
            label: 'Деньги',
            href: tabHref('money'),
            count: moneyRows.length,
            countTone: moneyPending ? 'warning' : 'default',
          },
          {
            key: 'compliance',
            label: 'KYC и AML',
            href: tabHref('compliance'),
            count: canDocs ? card.documents.length : undefined,
            countTone: card.state === 'pending' || amlStatus === 'escalated' ? 'warning' : 'default',
          },
          { key: 'access', label: 'Доступ и сессии', href: tabHref('access'), count: card.sessions.length },
          {
            key: 'credentials',
            label: 'Учётные данные',
            href: tabHref('credentials'),
            countTone: credentials.passwordMustChange || policy.withdrawBanned ? 'warning' : 'default',
            count: card.journal.filter((e) => e.action.startsWith('client.credentials.')).length || undefined,
          },
          {
            key: 'support',
            label: 'Поддержка',
            href: tabHref('support'),
            count: supportTickets.length,
            countTone: supportAwaiting ? 'warning' : 'default',
          },
          { key: 'journal', label: 'Журнал', href: tabHref('journal'), count: card.journal.length },
        ]}
      />

      {tab === 'overview' ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-5">
            <Panel
              title="Реальный счёт"
              description={real.lastActivityAt ? `Последняя торговая активность ${fmtDateTime(real.lastActivityAt)}` : 'Клиент на реальном счёте не торговал'}
              actions={
                <Link href={tabHref('trading')} className="text-[13px] font-medium text-accent hover:underline">
                  Позиции и сделки →
                </Link>
              }
            >
              {live.state !== 'ok' ? (
                <Callout tone="neutral" className="mb-4">
                  Терминал не ответил — equity и свободная маржа недоступны. Баланс и сделки — из проекции событий.
                </Callout>
              ) : null}
              <AccountStats trading={real} kind="real" live={liveReal} />
            </Panel>

            <Panel
              title="Ввод и вывод"
              count={moneyRows.length}
              description="Последние операции USDT TRC20; полная история — во вкладке «Деньги»"
              actions={
                <Link href={tabHref('money')} className="text-[13px] font-medium text-accent hover:underline">
                  Все операции →
                </Link>
              }
              flush
            >
              <DataTable
                bare
                aria-label="Последние операции ввода и вывода"
                columns={MONEY_COLUMNS.filter((c) => c.key !== 'note')}
                rows={moneyRows.slice(0, 6)}
                rowKey={(r) => r.id}
                rowTone={(r) => (r.rawStatus === 'needs_review' ? 'warning' : undefined)}
                empty={<EmptyState size="compact" title="Заявок на ввод и вывод не было" />}
              />
            </Panel>

            <Panel
              title="Демо-счёт"
              description="Учебные средства, не деньги клиента"
              actions={
                <Link href={tabHref('trading')} className="text-[13px] font-medium text-accent hover:underline">
                  Подробнее →
                </Link>
              }
            >
              <AccountStats trading={demo} kind="demo" live={liveOf('demo')} />
            </Panel>
          </div>

          <aside className="min-w-0 space-y-5">
            <Panel
              title="Менеджер клиента"
              description={canAssignManager ? 'Смена — с основанием, запись в журнал' : 'Закрепляет администратор'}
            >
              <div className="space-y-4">
                <DescriptionList
                  columns={1}
                  items={
                    manager
                      ? [
                          {
                            term: 'Менеджер',
                            value: managerIsMe ? `${manager.managerName} (вы)` : manager.managerName,
                            hint: `закреплён ${fmtDateTime(manager.assignedAt)}${manager.assignedByName ? ` · ${manager.assignedByName}` : ''}`,
                          },
                          { term: 'Основание', value: <span className="line-clamp-3">{manager.reason}</span> },
                        ]
                      : [{ term: 'Менеджер', value: <span className="text-muted">не закреплён</span> }]
                  }
                />
                {canAssignManager ? (
                  <div className="border-border border-t pt-4">
                    <AssignManagerForm
                      key={manager?.managerId ?? 'none'}
                      userId={card.userId}
                      currentManagerId={manager?.managerId ?? null}
                      managers={managerChoices}
                    />
                  </div>
                ) : null}
              </div>
            </Panel>

            <Panel title="Комплаенс">
              <DescriptionList
                columns={1}
                items={[
                  {
                    term: 'Верификация (KYC)',
                    value: <StatusBadge status={card.state} />,
                    hint: card.verificationUpdatedAt ? `обновлено ${fmtDateTime(card.verificationUpdatedAt)}` : undefined,
                  },
                  {
                    term: 'AML-скрининг',
                    value: <StatusBadge status={AML_KEY[amlStatus] ?? 'aml_unscreened'} />,
                    hint: aml?.screenedAt
                      ? `${fmtDateTime(aml.screenedAt)} · ${aml.screenedByName ?? '—'} · ${aml.listsChecked.map(sanctionsListLabel).join(', ') || 'списки не указаны'}`
                      : 'сверка по спискам не проводилась',
                  },
                  {
                    term: 'Доступ',
                    value: card.block.blocked ? <StatusBadge status="blocked" /> : <StatusBadge status="active" />,
                    hint: `активных сессий: ${card.sessions.length}`,
                  },
                  {
                    term: 'Документы',
                    value: !canDocs
                      ? 'видны операторам KYC'
                      : card.documents.length
                        ? card.documents.map((d) => DOC_KIND_LABELS[d.kind]).join(', ')
                        : 'не поданы',
                  },
                ]}
              />
            </Panel>

            <Panel title="Правила ввода и вывода" description="Итог настроек платформы и флагов клиента">
              <PolicySummary policy={policy} />
            </Panel>

            <Panel
              title="Последние действия"
              actions={
                <Link href={tabHref('journal')} className="text-[13px] font-medium text-accent hover:underline">
                  Журнал →
                </Link>
              }
            >
              <JournalFeed entries={card.journal} limit={5} withDetails={false} />
            </Panel>
          </aside>
        </div>
      ) : null}

      {tab === 'trading' ? (
        <div className="space-y-8">
          <TradingSection trading={real} title="Реальный счёт" kind="real" live={liveReal} />
          <TradingSection trading={demo} title="Демо-счёт" kind="demo" live={liveOf('demo')} />
        </div>
      ) : null}

      {tab === 'money' ? (
        <div className="space-y-5">
          <Panel
            title="Операции ввода и вывода"
            count={moneyRows.length}
            description="USDT, сеть TRON (TRC20). Решения по заявкам — в разделе «Деньги»."
            actions={
              canMoney ? (
                <Link href="/money" className="text-[13px] font-medium text-accent hover:underline">
                  Раздел «Деньги» →
                </Link>
              ) : undefined
            }
            flush
          >
            <DataTable
              bare
              aria-label="Операции ввода и вывода клиента"
              columns={MONEY_COLUMNS}
              rows={moneyRows}
              rowKey={(r) => r.id}
              rowTone={(r) => (r.rawStatus === 'needs_review' ? 'warning' : undefined)}
              empty={<EmptyState size="compact" title="Заявок на ввод и вывод не было" />}
            />
          </Panel>
          <div className="grid gap-5 xl:grid-cols-2">
            <Panel title="Правила ввода и вывода" description="Итог настроек платформы и флагов клиента" className="self-start">
              <PolicySummary policy={policy} />
            </Panel>
            {canMoney ? (
              <Panel
                title="Денежные флаги клиента"
                description="Изменение — с основанием, пишется в журнал. Заморозка сначала ставится в терминале."
              >
                <MoneyFlagsPanel
                  userId={card.userId}
                  flags={{
                    depositKyc: policyInputs.flags.depositKyc,
                    withdrawKyc: policyInputs.flags.withdrawKyc,
                    frozen: policyInputs.flags.frozen,
                    withdrawBanned: policyInputs.flags.withdrawBanned,
                  }}
                />
              </Panel>
            ) : null}
          </div>
        </div>
      ) : null}

      {tab === 'compliance' ? (
        <div className="grid gap-5 xl:grid-cols-2">
          <div className="min-w-0 space-y-5">
            <Panel
              title="Верификация (KYC)"
              description={card.verificationUpdatedAt ? `Состояние обновлено ${fmtDateTime(card.verificationUpdatedAt)}` : undefined}
              actions={
                card.state === 'pending' && canKyc ? (
                  <Link href={`/kyc/${card.userId}`} className="text-[13px] font-medium text-accent hover:underline">
                    Принять решение →
                  </Link>
                ) : (
                  <StatusBadge status={card.state} />
                )
              }
            >
              <VerificationTimeline journal={card.journal} />
            </Panel>
            {canDocs ? (
            <Panel title="Документы" count={card.documents.length} flush>
              {card.documents.length === 0 ? (
                <EmptyState size="compact" title="Документы не поданы" />
              ) : (
                <ul className="divide-y divide-border">
                  {card.documents.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-4 px-4 py-3">
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-primary">{DOC_KIND_LABELS[d.kind]}</span>
                        <span className="block truncate text-xs text-muted">
                          подан {fmtDateTime(d.submittedAt)}
                          {d.contentType ? ` · ${d.contentType}` : ''}
                        </span>
                      </span>
                      <ViewDocumentButton docId={d.id} />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            ) : null}
          </div>
          <Panel
            title="AML-скрининг"
            actions={
              canAml ? (
                <Link href={`/aml/${card.userId}`} className="text-[13px] font-medium text-accent hover:underline">
                  Сверка и решения →
                </Link>
              ) : undefined
            }
            className="self-start"
          >
            <DescriptionList
              columns={2}
              items={[
                { term: 'Статус', value: <StatusBadge status={AML_KEY[amlStatus] ?? 'aml_unscreened'} /> },
                { term: 'Последняя сверка', value: aml?.screenedAt ? fmtDateTime(aml.screenedAt) : '—', numeric: true, hint: aml?.screenedByName ?? undefined },
                { term: 'Проверенные списки', value: aml?.listsChecked.length ? aml.listsChecked.map(sanctionsListLabel).join(', ') : '—' },
                { term: 'Основание', value: aml?.reason ?? '—' },
              ]}
            />
            {aml && aml.history.length > 0 ? (
              <div className="mt-5 border-t border-border pt-4">
                <p className="mb-3 text-xs font-medium text-secondary">История сверок</p>
                <Timeline
                  items={aml.history.map((h) => {
                    const a = actionLabel(h.action);
                    return {
                      key: String(h.seq),
                      tone: a.tone,
                      title: a.label,
                      time: fmtDateTime(h.occurredAt),
                      meta: h.operatorName ?? '—',
                      body: h.basis ?? undefined,
                    };
                  })}
                />
              </div>
            ) : null}
          </Panel>
        </div>
      ) : null}

      {tab === 'access' ? (
        <div className="space-y-5">
          <Panel title="Активные сессии кабинета" count={card.sessions.length} flush>
            {card.sessions.length === 0 ? (
              <EmptyState size="compact" title="Активных сессий нет" />
            ) : (
              <ul className="divide-y divide-border">
                {card.sessions.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-3">
                    <span className="min-w-0">
                      <Mono value={s.ip ?? 'ip неизвестен'} className="text-primary" />
                      <span className="block max-w-xl truncate text-xs text-muted">{s.userAgent ?? 'user-agent неизвестен'}</span>
                    </span>
                    <span className="text-xs tabular-nums text-secondary">
                      создана {fmtDateTime(s.createdAt)} · до {fmtDateTime(s.expiresAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {isAdmin ? (
            <Panel
              tone="danger"
              title="Опасная зона"
              description="Только администратор. Каждое действие — с основанием и записью в неизменяемый журнал."
            >
              <BlockPanel userId={card.userId} blocked={card.block.blocked} />
            </Panel>
          ) : null}
        </div>
      ) : null}

      {tab === 'credentials' ? (
        <CredentialsTab
          userId={card.userId}
          email={card.email}
          emailVerifiedAt={card.emailVerifiedAt}
          journal={card.journal}
          view={credentials}
          policy={policy}
          managerName={manager ? (managerIsMe ? `${manager.managerName} (вы)` : manager.managerName) : null}
          tickets={supportTickets.map((t) => ({ number: t.number, subject: t.subject }))}
        />
      ) : null}

      {tab === 'support' ? <SupportTab rows={supportTickets} /> : null}

      {tab === 'journal' ? (
        <Panel
          title="Журнал действий по клиенту"
          count={card.journal.length}
          description="Неизменяемая хеш-цепочка; новые сверху. Раскройте запись, чтобы увидеть payload и хэши."
          actions={
            <Link href={`/journal?subjectKind=client&subjectId=${card.userId}`} className="text-[13px] font-medium text-accent hover:underline">
              Открыть в журнале →
            </Link>
          }
        >
          <JournalFeed entries={card.journal} />
        </Panel>
      ) : null}
    </div>
  );
}
