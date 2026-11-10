import Link from 'next/link';
import { DataTable, EmptyState, Panel, StatusBadge, type DataTableColumn } from '@broker/ui';
import type { QueueRow } from '@broker/support';
import { CHANNEL_SHORT, STATUS_KEY } from '@/lib/support/labels';
import { fmtDateTime } from '@/lib/ui/format';

/**
 * Вкладка «Поддержка» карточки клиента: обращения клиента (и гостевые с его
 * email — кандидаты на склейку). Ссылка ведёт в экран обращения.
 */
const COLUMNS: DataTableColumn<QueueRow>[] = [
  {
    key: 'ticket',
    header: 'Обращение',
    cell: (r) => (
      <Link href={`/support/${r.number}`} className="group block min-w-0">
        <span className="text-primary group-hover:text-accent block truncate font-medium">
          <span className="text-muted tabular-nums">#{r.number}</span> {r.subject}
        </span>
        <span className="text-muted block truncate text-xs">
          {r.userId ? `сообщений: ${r.messageCount}` : 'гостевое — тот же email, не привязано'}
        </span>
      </Link>
    ),
  },
  { key: 'ch', header: 'Канал', width: '6rem', cell: (r) => CHANNEL_SHORT[r.originChannel] },
  { key: 'st', header: 'Статус', width: '9rem', cell: (r) => <StatusBadge status={STATUS_KEY[r.status]} /> },
  { key: 'as', header: 'Назначен', width: '10rem', cell: (r) => r.assigneeName ?? <span className="text-muted">—</span> },
  { key: 'at', header: 'Создано', numeric: true, width: '10rem', cell: (r) => fmtDateTime(r.createdAt) },
];

export function SupportTab({ rows }: { rows: QueueRow[] }) {
  return (
    <Panel flush title="Обращения в поддержку" count={rows.length} description="Чат кабинета, письма и форма сайта; новые сверху.">
      <DataTable
        bare
        aria-label="Обращения клиента"
        columns={COLUMNS}
        rows={rows}
        rowKey={(r) => r.id}
        rowTone={(r) => (r.status === 'new' || r.status === 'open' ? 'warning' : undefined)}
        empty={<EmptyState size="compact" title="Обращений не было" description="Клиент не писал в поддержку ни из кабинета, ни письмом, ни с сайта." />}
      />
    </Panel>
  );
}
