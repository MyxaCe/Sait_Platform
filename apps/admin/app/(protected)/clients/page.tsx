import { listClients, asSort, type StateFilter } from '@/lib/clients/queries';
import { VERIFICATION_STATES } from '@/lib/clients/verification-state';
import { ClientsTable } from './_components/ClientsTable';
import { Filters } from './_components/Filters';

/**
 * Реестр клиентов `/clients` (ADM-02, §3.1): найти клиента и оценить его
 * состояние. Таблица — id/имя, состояние верификации (badge), дата регистрации,
 * активность, флаг блокировки; поиск, фильтр по состоянию, сортировка.
 *
 * Серверный компонент: читает из базы напрямую. Чтение НЕ журналируем (§3.1).
 * Доступ — operator+admin, закрыт гейтом (middleware + layout `(protected)`).
 */
export const dynamic = 'force-dynamic';

function asStateFilter(value: string | undefined): StateFilter {
  if (value && (VERIFICATION_STATES as readonly string[]).includes(value)) {
    return value as StateFilter;
  }
  return 'all';
}

export default async function ClientsRegistryPage({
  searchParams,
}: {
  searchParams: { q?: string; state?: string; sort?: string };
}) {
  const search = (searchParams.q ?? '').trim();
  const state = asStateFilter(searchParams.state);
  const sort = asSort(searchParams.sort);

  const clients = await listClients({ search, state, sort });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Клиенты</h1>
        <p className="text-sm text-secondary">
          Реестр клиентов платформы. Найдено: <span className="tabular-nums">{clients.length}</span>
          {clients.length === 500 ? ' (показаны первые 500 — уточните поиск)' : ''}.
        </p>
      </div>

      <Filters search={search} state={state} sort={sort} />

      <ClientsTable clients={clients} />
    </div>
  );
}
