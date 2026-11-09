import Link from 'next/link';
import {
  Callout,
  DataTable,
  EmptyState,
  KpiTile,
  PageHeader,
  Panel,
  StatusBadge,
  type DataTableColumn,
} from '@broker/ui';
import { listPendingClients, type PendingClient } from '@/lib/kyc/queries';
import { KYC_SLA_HOURS, getKycQueueStats, isKycOverdue, type KycQueueStats } from '@/lib/kyc/queue-view';
import { fmtAge, fmtDateTime } from '@/lib/ui/format';

/**
 * Очередь KYC `/kyc` (ADM-08, Р-451 п.4; концепция §7.1 «очередь»). Клиенты в
 * состоянии `pending`, старейшие сверху; дольше SLA — подсвечено. Пусто —
 * значит очередь разобрана, а не «что-то сломалось»: это сказано явно.
 *
 * Только чтение. Доступ — operator+admin (гейт layout `(protected)` + middleware).
 */
export const dynamic = 'force-dynamic';

/** Видов документов по Р-451 п.4 (паспорт, селфи, адрес, источник средств). */
const DOC_KINDS_TOTAL = 4;

const COLUMNS: DataTableColumn<PendingClient>[] = [
  {
    key: 'client',
    header: 'Клиент',
    className: 'min-w-[12rem]',
    cell: (c) => (
      <Link href={`/kyc/${c.userId}`} className="group block min-w-0 max-w-[12rem] xl:max-w-[24rem]">
        <span className="block truncate font-medium text-primary group-hover:text-accent" title={c.fullName}>
          {c.fullName}
        </span>
        <span className="block truncate text-xs text-muted" title={c.email}>
          {c.email}
        </span>
      </Link>
    ),
  },
  {
    key: 'docs',
    header: 'Документы',
    numeric: true,
    width: '7rem',
    cell: (c) => (
      <span className={c.documentCount === 0 ? 'text-warning' : undefined}>
        {c.documentCount}
        <span className="text-muted"> из {DOC_KINDS_TOTAL}</span>
      </span>
    ),
  },
  {
    key: 'since',
    header: 'На проверке с',
    numeric: true,
    align: 'left',
    width: '10rem',
    className: 'hidden xl:table-cell',
    cell: (c) => <span className="text-secondary">{fmtDateTime(c.updatedAt)}</span>,
  },
  {
    key: 'age',
    header: 'В очереди',
    numeric: true,
    width: '8rem',
    cell: (c) => (
      <span className={isKycOverdue(c.updatedAt) ? 'font-medium text-warning' : undefined}>
        {fmtAge(c.updatedAt)}
      </span>
    ),
  },
  { key: 'state', header: 'Статус', width: '9rem', cell: () => <StatusBadge status="pending" /> },
  {
    key: 'go',
    header: <span className="sr-only">Действие</span>,
    align: 'right',
    className: 'relative',
    width: '7rem',
    cell: (c) => (
      <Link href={`/kyc/${c.userId}`} className="text-[13px] font-medium text-accent hover:underline">
        Проверить
      </Link>
    ),
  },
];

function OpenLink({ href, children = 'Открыть →' }: { href: string; children?: React.ReactNode }) {
  return (
    <Link href={href} className="font-medium text-accent hover:underline">
      {children}
    </Link>
  );
}

export default async function KycQueuePage() {
  let pending: PendingClient[] | null = null;
  let stats: KycQueueStats | null = null;
  try {
    [pending, stats] = await Promise.all([listPendingClients(), getKycQueueStats()]);
  } catch (error) {
    console.error('[kyc] очередь не прочитана', error instanceof Error ? error.message : error);
  }

  const oldest = pending?.[0];
  const overdue = pending?.filter((p) => isKycOverdue(p.updatedAt)).length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Верификация"
        description="Клиенты, ждущие решения по документам KYC. Старейшие сверху."
        meta={<span className="tabular-nums">Срез на {fmtDateTime(new Date())}</span>}
      />

      {pending === null || stats === null ? (
        <Callout tone="negative" title="Очередь не загрузилась">
          База платформы не ответила. Список заявок не показан, чтобы пустой экран не приняли за
          разобранную очередь. Обновите страницу.
        </Callout>
      ) : (
        <>
          <section aria-label="Сводка очереди" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile
              label="Ждут решения"
              value={pending.length}
              tone={pending.length > 0 ? 'warning' : 'default'}
              hint={pending.length > 0 ? 'решение — с основанием' : 'очередь разобрана'}
            />
            <KpiTile
              label={`Дольше ${KYC_SLA_HOURS} ч`}
              value={overdue}
              tone={overdue > 0 ? 'warning' : 'default'}
              hint={overdue > 0 ? 'подсвечены в таблице' : 'просроченных нет'}
            />
            <KpiTile
              label="Старейшая заявка"
              value={oldest ? fmtAge(oldest.updatedAt) : '—'}
              tone={oldest && isKycOverdue(oldest.updatedAt) ? 'warning' : 'default'}
              hint={oldest ? oldest.fullName : 'нет заявок'}
            />
            <KpiTile
              label="Ждут клиента"
              value={stats.resubmit}
              hint="запрошена переподача"
              action={stats.resubmit > 0 ? <OpenLink href="/clients?kyc=resubmit_requested" /> : undefined}
            />
          </section>

          <Panel
            title="Очередь верификации"
            count={pending.length}
            description={`Старейшие сверху. Дольше ${KYC_SLA_HOURS} ч — подсвечено.`}
            flush
          >
            <DataTable
              bare
              aria-label="Клиенты, ожидающие решения KYC"
              columns={COLUMNS}
              rows={pending}
              rowKey={(c) => c.userId}
              rowTone={(c) => (isKycOverdue(c.updatedAt) ? 'warning' : undefined)}
              empty={
                <EmptyState
                  size="compact"
                  title="Очередь пуста"
                  description="Клиентов, ожидающих проверки документов, нет. Новые заявки появятся здесь, когда клиент отправит документы из кабинета."
                />
              }
            />
          </Panel>
        </>
      )}
    </div>
  );
}
