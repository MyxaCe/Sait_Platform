import Link from 'next/link';
import {
  Callout,
  DataTable,
  EmptyState,
  KpiTile,
  PageHeader,
  Panel,
  Tabs,
  ToneBadge,
  type DataTableColumn,
} from '@broker/ui';
import {
  listInboundTransfers,
  listOutgoingTransfers,
  managerTransferReport,
  unseenTransferCounts,
  type InboundTransferRow,
  type ManagerReportRow,
  type OutgoingTransferRow,
} from '@broker/transfer';
import { getOperatorSession } from '@/lib/auth/current';
import { getPool } from '@/lib/db';
import { fmtDateTime } from '@/lib/ui/format';
import { inboundStatus, transferStatus } from '@/lib/transfer/labels';
import { canReviewTransfers } from '@/lib/transfer/runtime';
import { MarkSeenForm, RefundTaskForm } from '../_components/transfer/TransferActions';

/**
 * «Переводы клиентов» (раздел «Клиенты»). Admin видит ВСЕ переводы
 * постфактум — кто провёл, тикет-основание, статус в цели — и уведомление о
 * непросмотренных; отчёт по менеджерам с алертом. Менеджер видит свои.
 * Вкладка «Входящие» — переводы на эту платформу из других платформ группы.
 */
export const dynamic = 'force-dynamic';

type Tab = 'out' | 'in' | 'report';

const OUT_COLUMNS: DataTableColumn<OutgoingTransferRow>[] = [
  {
    key: 'number',
    header: 'Перевод',
    mono: true,
    cell: (r) => (
      <Link href={`/clients/transfers/${r.id}`} className="text-accent hover:underline">
        {r.number}
      </Link>
    ),
  },
  {
    key: 'client',
    header: 'Клиент',
    cell: (r) => (
      <span className="min-w-0">
        <Link href={`/clients/${r.userId}`} className="text-primary hover:underline">
          {r.clientName}
        </Link>
        <span className="text-muted block text-xs">{r.clientCountry ?? '—'}</span>
      </span>
    ),
  },
  { key: 'target', header: 'Куда', cell: (r) => r.targetName ?? r.targetPlatform },
  { key: 'initiator', header: 'Провёл', cell: (r) => r.initiatorName },
  {
    key: 'ticket',
    header: 'Заявление',
    cell: (r) => (
      <Link href={`/support/${r.ticketNumber}`} className="text-accent hover:underline">
        тикет #{r.ticketNumber}
      </Link>
    ),
  },
  {
    key: 'status',
    header: 'Статус',
    cell: (r) => {
      const s = transferStatus(r.status);
      return (
        <span className="flex flex-wrap items-center gap-1.5">
          <ToneBadge tone={s.tone}>{s.label}</ToneBadge>
          {r.hints.length ? <ToneBadge tone="warning" plain>подсказки: {r.hints.length}</ToneBadge> : null}
          {!r.adminSeenAt ? <ToneBadge tone="warning" plain>новый</ToneBadge> : null}
        </span>
      );
    },
  },
  { key: 'created', header: 'Когда', numeric: true, cell: (r) => fmtDateTime(r.createdAt) },
];

const IN_COLUMNS: DataTableColumn<InboundTransferRow>[] = [
  { key: 'number', header: 'Перевод', mono: true, cell: (r) => r.number },
  {
    key: 'client',
    header: 'Клиент',
    cell: (r) => (
      <span>
        {r.registeredUserId ? (
          <Link href={`/clients/${r.registeredUserId}`} className="text-primary hover:underline">
            {r.fullName}
          </Link>
        ) : (
          r.fullName
        )}
        <span className="text-muted block text-xs">
          {r.email} · {r.country ?? '—'}
        </span>
      </span>
    ),
  },
  { key: 'source', header: 'Откуда', cell: (r) => r.sourceName ?? r.sourcePlatform },
  {
    key: 'kyc',
    header: 'KYC в источнике',
    cell: (r) => (r.sourceKycState === 'verified' ? 'подтверждён' : (r.sourceKycState ?? '—')),
  },
  {
    key: 'status',
    header: 'Статус',
    cell: (r) => {
      const s = inboundStatus(r.status);
      return (
        <span className="flex flex-wrap items-center gap-1.5">
          <ToneBadge tone={s.tone}>{s.label}</ToneBadge>
          {r.refundTask === 'open' ? <ToneBadge tone="warning">вернуть средства</ToneBadge> : null}
          {r.freezeState === 'pending' ? <ToneBadge tone="info" plain>заморозка в терминале — повтор</ToneBadge> : null}
        </span>
      );
    },
  },
  { key: 'received', header: 'Принят', numeric: true, cell: (r) => fmtDateTime(r.receivedAt) },
];

const REPORT_COLUMNS: DataTableColumn<ManagerReportRow>[] = [
  { key: 'name', header: 'Менеджер', cell: (r) => r.name },
  { key: 't30', header: 'Переводов за 30 дн', numeric: true, cell: (r) => r.total30d },
  { key: 'r30', header: 'Возвращено за 30 дн', numeric: true, cell: (r) => r.revoked30d },
  { key: 'rall', header: 'Возвращено всего', numeric: true, cell: (r) => r.revokedAllTime },
  {
    key: 'alert',
    header: 'Сигнал',
    cell: (r) =>
      r.alert === 'absolute' ? (
        <ToneBadge tone="warning">больше 10 за 30 дн</ToneBadge>
      ) : r.alert === 'aboveMedian' ? (
        <ToneBadge tone="warning">вдвое выше медианы</ToneBadge>
      ) : (
        <span className="text-muted">—</span>
      ),
  },
];

export default async function TransfersPage({ searchParams }: { searchParams: { tab?: string } }) {
  const operator = await getOperatorSession();
  const isAdmin = canReviewTransfers(operator?.role);
  const tab: Tab = searchParams.tab === 'in' && isAdmin ? 'in' : searchParams.tab === 'report' && isAdmin ? 'report' : 'out';
  const db = getPool();
  const [outgoing, inbound, report, unseen] = await Promise.all([
    listOutgoingTransfers(db, isAdmin ? {} : { initiatorId: operator?.operatorId ?? '00000000-0000-0000-0000-000000000000' }),
    isAdmin ? listInboundTransfers(db) : Promise.resolve([]),
    isAdmin ? managerTransferReport(db) : Promise.resolve([]),
    isAdmin ? unseenTransferCounts(db) : Promise.resolve({ outgoing: 0, inbound: 0, refundTasks: 0 }),
  ]);
  const href = (t: Tab) => (t === 'out' ? '/clients/transfers' : `/clients/transfers?tab=${t}`);
  const alerts = report.filter((r) => r.alert);
  const openRefunds = inbound.filter((r) => r.refundTask === 'open');

  return (
    <div className="space-y-5">
      <PageHeader
        title="Переводы клиентов"
        description={
          isAdmin
            ? 'Переводы на другие платформы группы проводят менеджеры клиентов по заявлению клиента в поддержку. Вы видите каждый перевод постфактум и можете вернуть его.'
            : 'Ваши переводы клиентов на другие платформы группы.'
        }
      />

      {isAdmin ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiTile label="Новые исходящие" value={unseen.outgoing} tone={unseen.outgoing ? 'warning' : 'default'} hint="не просмотрены администратором" />
          <KpiTile label="Новые входящие" value={unseen.inbound} tone={unseen.inbound ? 'warning' : 'default'} hint="из других платформ группы" />
          <KpiTile label="Задачи «вернуть средства»" value={unseen.refundTasks} tone={unseen.refundTasks ? 'warning' : 'default'} hint="по отозванным переводам" />
          <KpiTile label="Сигналы по менеджерам" value={alerts.length} tone={alerts.length ? 'warning' : 'default'} hint="за 30 дней, информационно" />
        </div>
      ) : null}

      {isAdmin && unseen.outgoing + unseen.inbound > 0 ? (
        <Callout tone="warning" title={`Непросмотренных переводов: ${unseen.outgoing + unseen.inbound}`}>
          <div className="space-y-3">
            <p>Проверьте основание (тикет клиента) и подсказки юрисдикций. Если перевод проведён неверно — откройте его и нажмите «Вернуть перевод».</p>
            <div className="max-w-xl">
              <MarkSeenForm />
            </div>
          </div>
        </Callout>
      ) : null}

      {isAdmin ? (
        <Tabs
          linkComponent={Link}
          active={tab}
          aria-label="Переводы"
          items={[
            { key: 'out', label: 'Исходящие', href: href('out'), count: outgoing.length, countTone: unseen.outgoing ? 'warning' : 'default' },
            { key: 'in', label: 'Входящие', href: href('in'), count: inbound.length, countTone: openRefunds.length ? 'warning' : 'default' },
            { key: 'report', label: 'По менеджерам', href: href('report'), count: alerts.length || undefined, countTone: alerts.length ? 'warning' : 'default' },
          ]}
        />
      ) : null}

      {tab === 'out' ? (
        <Panel title="Исходящие переводы" count={outgoing.length} flush>
          <DataTable
            bare
            columns={OUT_COLUMNS}
            rows={outgoing}
            rowKey={(r) => r.id}
            rowTone={(r) => (r.status === 'revoked' || r.status === 'refused' ? 'negative' : !r.adminSeenAt && isAdmin ? 'warning' : undefined)}
            empty={<EmptyState title="Переводов нет" description="Перевод проводит менеджер из карточки клиента по его заявлению в поддержку." />}
            aria-label="Исходящие переводы"
          />
        </Panel>
      ) : null}

      {tab === 'in' ? (
        <div className="space-y-5">
          <Panel title="Входящие переводы" count={inbound.length} description="Приглашения клиентам других платформ группы. Счёт клиент открывает сам, KYC — заново." flush>
            <DataTable
              bare
              columns={IN_COLUMNS}
              rows={inbound}
              rowKey={(r) => r.transferId}
              rowTone={(r) => (r.refundTask === 'open' ? 'warning' : r.status === 'revoked' ? 'negative' : undefined)}
              empty={<EmptyState title="Входящих переводов нет" />}
              aria-label="Входящие переводы"
            />
          </Panel>
          {openRefunds.map((r) => (
            <Panel
              key={r.transferId}
              title={`Вернуть средства: ${r.fullName} (${r.number})`}
              description="Перевод отозван группой после регистрации, клиент уже пополнил счёт. Верните средства обычной заявкой на вывод (счёт заморожен и вывод запрещён — на время вывода снимите запрет в карточке клиента, вкладка «Деньги»), затем закройте задачу."
            >
              <div className="max-w-xl">
                <RefundTaskForm transferId={r.transferId} />
              </div>
            </Panel>
          ))}
        </div>
      ) : null}

      {tab === 'report' ? (
        <Panel
          title="Переводы по менеджерам"
          description="Информационно (§2.1(3) проекта): поток переводов от одного менеджера — повод проверить, не было ли предложения. Сигнал: больше 10 за 30 дней или вдвое выше медианы коллег."
          flush
        >
          <DataTable bare columns={REPORT_COLUMNS} rows={report} rowKey={(r) => r.operatorId} rowTone={(r) => (r.alert ? 'warning' : undefined)} aria-label="Отчёт по менеджерам" />
        </Panel>
      ) : null}
    </div>
  );
}
