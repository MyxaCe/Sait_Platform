import Link from 'next/link';
import type { ClientRow } from '@/lib/clients/queries';
import { formatMoneyCents } from '@/lib/clients/trading';
import { BlockBadge, VerificationBadge } from './StatusBadge';

/**
 * Плотная таблица-реестр (§3.1, §5.3 `DataTable`). Локальная, без packages/ui:
 * компактные строки, zebra через `card`/`elevated`, числа/даты `tabular-nums`,
 * пустое состояние явным текстом. Строка целиком — ссылка на карточку (§3.1
 * действие «открыть карточку»).
 */

function dateFmt(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { dateStyle: 'medium' });
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

export function ClientsTable({ clients }: { clients: ClientRow[] }) {
  if (clients.length === 0) {
    return (
      <p className="rounded border border-border bg-elevated px-4 py-6 text-center text-secondary">
        Ничего не найдено — ни одного клиента под текущие условия поиска и фильтра.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-elevated text-left text-xs uppercase text-secondary">
            <th className="px-4 py-2 font-medium">Клиент</th>
            <th className="px-4 py-2 font-medium">Верификация</th>
            <th className="px-4 py-2 font-medium">Регистрация</th>
            <th className="px-4 py-2 font-medium">Активность</th>
            <th className="px-4 py-2 text-right font-medium">Реальный счёт</th>
            <th className="px-4 py-2 font-medium">Блокировка</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((c, i) => (
            <tr
              key={c.userId}
              className={`border-b border-border last:border-0 hover:bg-accent/5 ${
                i % 2 === 1 ? 'bg-card' : 'bg-base'
              }`}
            >
              <td className="px-4 py-2">
                <Link href={`/clients/${c.userId}`} className="block min-w-0">
                  <span className="block truncate font-medium text-primary hover:text-accent">
                    {c.fullName}
                  </span>
                  <span className="block truncate text-xs text-secondary">
                    {c.email} · <span className="tabular-nums">{shortId(c.userId)}</span>
                  </span>
                </Link>
              </td>
              <td className="px-4 py-2">
                <VerificationBadge state={c.state} />
              </td>
              <td className="px-4 py-2 tabular-nums text-secondary">{dateFmt(c.registeredAt)}</td>
              <td className="px-4 py-2 tabular-nums text-secondary">
                {c.lastLoginAt ? dateFmt(c.lastLoginAt) : <span className="text-secondary/60">—</span>}
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-primary">
                {c.balanceCents === null ? (
                  <span className="text-secondary/60">—</span>
                ) : (
                  formatMoneyCents(c.balanceCents, c.currency ?? 'USD')
                )}
              </td>
              <td className="px-4 py-2">
                {c.blocked ? (
                  <BlockBadge blocked />
                ) : (
                  <span className="text-xs text-secondary/60">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
