import Link from 'next/link';
import { listPendingClients } from '@/lib/kyc/queries';

/**
 * Очередь KYC (ADM-08, Р-451 п.4): клиенты в состоянии `pending`, ждущие
 * решения оператора. Старые сверху. Пусто — значит очередь разобрана, а не
 * «что-то сломалось»: показываем это явно.
 *
 * Серверный компонент: читает из базы напрямую, без клиентской `/api`-ручки.
 * Доступ закрыт гейтом (layout `(protected)` + middleware).
 */
export const dynamic = 'force-dynamic';

export default async function KycQueuePage() {
  const clients = await listPendingClients();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Проверка клиентов</h1>
        <p className="text-sm text-secondary">
          Клиенты, ожидающие решения (состояние pending). Всего: {clients.length}.
        </p>
      </div>

      {clients.length === 0 ? (
        <p className="rounded border border-border bg-elevated px-4 py-6 text-center text-secondary">
          Очередь пуста — клиентов в ожидании проверки нет.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded border border-border bg-elevated">
          {clients.map((c) => (
            <li key={c.userId}>
              <Link
                href={`/kyc/${c.userId}`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-accent/5"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-primary">{c.fullName}</span>
                  <span className="block truncate text-sm text-secondary">{c.email}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3 text-sm text-secondary">
                  <span>{c.documentCount} док.</span>
                  <span className="rounded bg-accent/20 px-2 py-0.5 text-xs uppercase text-accent">
                    pending
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
