import Link from 'next/link';
import {
  DataTable,
  EmptyState,
  StatusBadge,
  ToneBadge,
  initialsOf,
  type DataTableColumn,
} from '@broker/ui';
import type { OperatorListItem } from '@/lib/operators/queries';
import { fmtDate } from '@/lib/ui/format';
import { ROLE_LABEL } from './roles';

/**
 * Таблица операторов (ADM-04, концепция §6.1): кто, роль, 2FA, статус, когда
 * заведён. Строка-переход — «Управлять» открывает панель оператора справа
 * (`?op=id`, без JS). Над собой действий нет (нельзя отключить/понизить себя) —
 * вместо ссылки «это вы».
 */
export function OperatorsTable({
  operators,
  currentOperatorId,
  selectedId,
  managerClients = new Map(),
  revokedTransfers = new Map(),
}: {
  operators: OperatorListItem[];
  currentOperatorId: string;
  selectedId?: string;
  /** Число закреплённых клиентов по оператору (ветка admin-managers). */
  managerClients?: Map<string, number>;
  /** Возвращённые admin переводы, проведённые оператором (ветка client-transfer). */
  revokedTransfers?: Map<string, number>;
}) {
  const columns: DataTableColumn<OperatorListItem>[] = [
    {
      key: 'who',
      header: 'Оператор',
      cell: (op) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden
            className="bg-primary/[0.08] text-primary flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
          >
            {initialsOf(op.displayName)}
          </span>
          <span className="min-w-0">
            <span
              className={
                op.disabledAt
                  ? 'text-muted block truncate font-medium line-through'
                  : 'text-primary block truncate font-medium'
              }
            >
              {op.displayName}
            </span>
            <span className="text-muted block truncate font-mono text-xs">{op.login}</span>
          </span>
        </span>
      ),
    },
    {
      key: 'role',
      header: 'Роль',
      width: '10rem',
      cell: (op) => (
        <span className="flex flex-col items-start gap-0.5">
          <span className="text-primary">{ROLE_LABEL[op.role]}</span>
          {op.isClientManager ? (
            <span className="text-secondary text-xs tabular-nums">
              менеджер · клиентов {managerClients.get(op.id) ?? 0}
            </span>
          ) : null}
          {/* ── Переводы клиентов (ветка client-transfer): возвращённые переводы менеджера ── */}
          {revokedTransfers.get(op.id) ? (
            <span className="text-negative text-xs tabular-nums">возвращено переводов {revokedTransfers.get(op.id)}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'access',
      header: 'Доступ',
      width: '9rem',
      cell: (op) => (
        <span className="flex flex-col items-start gap-0.5">
          {op.disabledAt ? (
            <ToneBadge tone="negative">Отключён</ToneBadge>
          ) : (
            <StatusBadge status="active" />
          )}
          <span
            className={
              op.totpEnrolled || op.disabledAt
                ? 'text-muted text-xs'
                : 'text-warning text-xs font-medium'
            }
          >
            {op.totpEnrolled ? '2FA включена' : '2FA не включена'}
          </span>
        </span>
      ),
    },
    {
      key: 'created',
      header: 'Заведён',
      numeric: true,
      width: '6.5rem',
      cell: (op) => <span className="text-secondary">{fmtDate(op.createdAt)}</span>,
    },
    {
      key: 'go',
      header: <span className="sr-only">Действие</span>,
      width: '6rem',
      align: 'right',
      cell: (op) =>
        op.id === currentOperatorId ? (
          <span className="text-muted text-xs">это вы</span>
        ) : op.disabledAt ? (
          <span className="text-muted text-xs">—</span>
        ) : (
          <Link
            href={`/operators?op=${op.id}`}
            className="text-accent text-[13px] font-medium hover:underline"
            aria-label={`Управлять доступом ${op.displayName}`}
          >
            Управлять
          </Link>
        ),
    },
  ];

  return (
    <DataTable
      bare
      aria-label="Операторы центра управления"
      columns={columns}
      rows={operators}
      rowKey={(op) => op.id}
      selectedKey={selectedId}
      rowTone={(op) => (op.disabledAt ? undefined : !op.totpEnrolled ? 'warning' : undefined)}
      empty={
        <EmptyState
          size="compact"
          title="Операторов пока нет"
          description="Первый администратор создаётся при развёртывании платформы."
        />
      }
    />
  );
}
