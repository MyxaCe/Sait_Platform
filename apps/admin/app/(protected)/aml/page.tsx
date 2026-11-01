import Link from 'next/link';
import { listAmlWorklist } from '@/lib/aml/queries';
import { AML_STATUS_LABELS, type AmlStatus } from '@/lib/aml/lists';

/**
 * Рабочий список AML-скрининга (ADM-14, Р-454 I-5). Клиенты с заведённой
 * верификацией; сверху — требующие внимания: сперва `escalated` (найдено),
 * затем `unscreened` (не сверялись), затем `clear`.
 *
 * Скрининг РУЧНОЙ: оператор сверяет клиента во внешних источниках (OFSI/OFAC/EU,
 * PEP) и фиксирует результат в карточке. Серверный компонент: читает из базы
 * напрямую, без клиентской `/api`-ручки. Доступ закрыт гейтом (layout
 * `(protected)` + middleware), роли operator+admin.
 */
export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<AmlStatus, string> = {
  escalated: 'bg-negative/15 text-negative',
  unscreened: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  clear: 'bg-positive/15 text-positive',
};

function dateFmt(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
}

export default async function AmlWorklistPage() {
  const rows = await listAmlWorklist();
  const escalated = rows.filter((r) => r.status === 'escalated').length;
  const unscreened = rows.filter((r) => r.status === 'unscreened').length;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">AML-скрининг</h1>
        <p className="text-sm text-secondary">
          Ручная сверка клиентов по санкционным спискам (OFSI/OFAC/EU) и PEP. Проверку оператор
          делает во внешних источниках; здесь фиксируется результат с основанием. Всего клиентов:{' '}
          {rows.length} · на эскалации: {escalated} · не сверялись: {unscreened}.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded border border-border bg-elevated px-4 py-6 text-center text-secondary">
          Клиентов для скрининга нет — очередь верификации пуста.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded border border-border bg-elevated">
          {rows.map((r) => (
            <li key={r.userId}>
              <Link
                href={`/aml/${r.userId}`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-accent/5"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-primary">{r.fullName}</span>
                  <span className="block truncate text-sm text-secondary">{r.email}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3 text-sm text-secondary">
                  {r.screenedAt ? <span>свёрен {dateFmt(r.screenedAt)}</span> : null}
                  <span
                    className={`rounded px-2 py-0.5 text-xs uppercase ${STATUS_TONE[r.status]}`}
                  >
                    {AML_STATUS_LABELS[r.status]}
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
