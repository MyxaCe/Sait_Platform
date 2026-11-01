import Link from 'next/link';
import { KpiTile, DataTable, StatusBadge, type DataTableColumn } from '@broker/ui';
import { listPendingClients, type PendingClient } from '@/lib/kyc/queries';
import { HealthIndicator } from '@/components/shell/HealthIndicator';

/**
 * Дашборд `/` (ADM-07, §3.0/§4). Операционный пульт, не витрина: отвечает на
 * «всё ли здорово?» и «где меня ждут?». Числа — мгновенные и точные,
 * `tabular-nums`, БЕЗ анимации-разгона (§5.4).
 *
 * Реальные данные берём там, где они уже есть: здоровье — `/api/health`; KYC в
 * очереди — `client_verification.state='pending'` (кол-во + возраст старейшей).
 * Где данных пока нет (экспозиция, объёмы, dual-control-очередь) — честный
 * плейсхолдер «скоро», а не выдуманное число.
 */
export const dynamic = 'force-dynamic';

/** Возраст в человекочитаемом виде (ru). Только для показа, не для логики. */
function formatAge(fromIso: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(fromIso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return '<1 мин';
  if (min < 60) return `${min} мин`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ч`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days} дн ${remHours} ч` : `${days} дн`;
}

const QUEUE_COLUMNS: DataTableColumn<PendingClient>[] = [
  {
    key: 'client',
    header: 'Клиент',
    cell: (c) => (
      <Link href={`/kyc/${c.userId}`} className="block hover:text-accent">
        <span className="block truncate font-medium text-primary">{c.fullName}</span>
        <span className="block truncate text-xs text-secondary">{c.email}</span>
      </Link>
    ),
  },
  { key: 'docs', header: 'Док.', numeric: true, width: '5rem', cell: (c) => c.documentCount },
  { key: 'age', header: 'В очереди', numeric: true, width: '8rem', cell: (c) => formatAge(c.updatedAt) },
  {
    key: 'state',
    header: 'Статус',
    width: '8rem',
    cell: () => <StatusBadge status="pending" />,
  },
];

export default async function ControlCenterHome() {
  const pending = await listPendingClients();
  // Очередь отсортирована по возрастанию updated_at → старейшая первая.
  const oldest = pending[0];

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Дашборд</h1>
        <p className="text-sm text-secondary">Всё ли здорово и где вас ждут.</p>
      </div>

      {/* Ряд KPI-плиток (§4.1) */}
      <section aria-label="Ключевые показатели">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <KpiTile label="Здоровье платформы" value={<HealthIndicator variant="tile" />} />
          <KpiTile
            label="KYC в очереди"
            value={pending.length}
            tone={pending.length > 0 ? 'warning' : 'default'}
            hint={oldest ? `старейшая: ${formatAge(oldest.updatedAt)}` : 'очередь пуста'}
          />
          <KpiTile label="Операции на ревью" placeholder />
          <KpiTile label="Ждут моего 2-го подтв." placeholder />
          <KpiTile label="Экспозиция / ср. плечо" placeholder />
          <KpiTile label="Активные / объём 24ч" placeholder />
        </div>
      </section>

      {/* Где меня ждут: живая очередь верификации (§3.0) */}
      <section aria-label="Очередь верификации" className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-medium">Очередь верификации</h2>
          <Link href="/kyc" className="text-sm text-accent hover:underline">
            весь раздел →
          </Link>
        </div>
        <DataTable
          aria-label="Клиенты, ожидающие решения KYC"
          columns={QUEUE_COLUMNS}
          rows={pending}
          rowKey={(c) => c.userId}
          empty="Очередь пуста — клиентов в ожидании проверки нет."
        />
      </section>
    </div>
  );
}
