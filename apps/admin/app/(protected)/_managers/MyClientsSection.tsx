import Link from 'next/link';
import { DataTable, EmptyState, KpiTile, Money, Panel, StatusBadge, type DataTableColumn } from '@broker/ui';
import type { MyClientRow, MyClientsSummary } from '@/lib/managers/queries';
import { fmtDateTime, fmtRelativeDay } from '@/lib/ui/format';

/**
 * Дашборд менеджера: «Мои клиенты» (ветка admin-managers). Показывается только
 * оператору с флагом «менеджер клиентов». Те же правила, что у остального
 * дашборда: только чтение, числа точные, чего не знаем — не показываем.
 * Ссылки ведут в реестр с фильтром «Мои клиенты» (+ KYC при необходимости).
 */

const COLUMNS: DataTableColumn<MyClientRow>[] = [
  {
    key: 'name',
    header: 'Клиент',
    cell: (c) => (
      <Link href={`/clients/${c.userId}`} className="group block min-w-0">
        <span className="text-primary group-hover:text-accent block truncate font-medium">{c.fullName}</span>
        <span className="text-muted block truncate text-xs">{c.email}</span>
      </Link>
    ),
  },
  { key: 'kyc', header: 'KYC', width: '8.5rem', cell: (c) => <StatusBadge status={c.kyc} /> },
  {
    key: 'balance',
    header: 'Реальный счёт, USDT',
    numeric: true,
    width: '9rem',
    cell: (c) => <Money minor={c.balanceMinor} currency="USDT" hideCurrency />,
  },
  {
    key: 'deposit',
    header: 'Последний депозит',
    width: '9rem',
    cell: (c) =>
      c.lastDepositAt ? (
        <span className="text-secondary tabular-nums">{fmtRelativeDay(c.lastDepositAt)}</span>
      ) : (
        <span className="text-muted">не было</span>
      ),
  },
  {
    key: 'login',
    header: 'Последний вход',
    width: '9.5rem',
    cell: (c) =>
      c.lastLoginAt ? (
        <span className="text-secondary tabular-nums">{fmtDateTime(c.lastLoginAt)}</span>
      ) : (
        <span className="text-muted">никогда</span>
      ),
  },
];

export function MyClientsKpis({ summary }: { summary: MyClientsSummary }) {
  return (
    <section aria-label="Мои клиенты" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiTile
        label="Мои клиенты"
        value={summary.total}
        hint={`входили за 7 дн ${summary.active7d} · не входили 30 дн ${summary.dormant30d}`}
        action={
          <Link href="/clients?mgr=mine" className="text-accent font-medium hover:underline">
            Открыть →
          </Link>
        }
      />
      <KpiTile
        label="Мои: ждут KYC"
        value={summary.kycPending}
        tone={summary.kycPending > 0 ? 'warning' : 'default'}
        hint={`ещё не подавали документы: ${summary.kycNotStarted}`}
        action={
          <Link href="/clients?mgr=mine&kyc=pending" className="text-accent font-medium hover:underline">
            Открыть →
          </Link>
        }
      />
      <KpiTile
        label="Мои: депозиты за 7 дней"
        value={<Money minor={summary.deposits7dMinor} currency="USDT" />}
        hint={`зачислено пополнений: ${summary.deposits7d}`}
      />
      <KpiTile
        label="Мои: выводы ждут решения"
        value={summary.withdrawalsPending}
        tone={summary.withdrawalsPending > 0 ? 'warning' : 'default'}
        hint="решает финансовый оператор"
      />
    </section>
  );
}

export function MyClientsPanel({ rows, total }: { rows: MyClientRow[]; total: number }) {
  return (
    <Panel
      title="Мои клиенты"
      count={total}
      description="Сначала ждущие проверки KYC, затем не подавшие документы, далее — по последнему входу."
      actions={
        <Link href="/clients?mgr=mine" className="text-accent font-medium hover:underline">
          Все мои →
        </Link>
      }
      flush
    >
      <DataTable
        bare
        aria-label="Мои клиенты"
        columns={COLUMNS}
        rows={rows}
        rowKey={(c) => c.userId}
        rowTone={(c) => (c.kyc === 'pending' ? 'warning' : undefined)}
        empty={
          <EmptyState
            size="compact"
            title="За вами пока нет клиентов"
            description="Клиентов закрепляет администратор — в карточке клиента или массово из реестра."
          />
        }
      />
    </Panel>
  );
}
