import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getOperatorSession } from '@/lib/auth/current';
import { LOGIN_PATH } from '@/lib/auth/constants';
import {
  listJournalEntries,
  listOperatorsForFilter,
  listDistinctActions,
  listDistinctSubjectKinds,
  type JournalFilters,
} from './queries';
import { FilterBar } from './_components/FilterBar';
import { JournalFeed } from './_components/JournalFeed';
import { ChainStatus } from './_components/ChainStatus';
import { ExportButton } from './_components/ExportButton';

/**
 * Журнал/аудит `/journal` (ADM-06, § 3.10).
 *
 * Серверный компонент: читает журнал напрямую из базы под роль-видимость
 * (operator — свои + общие; admin — все). Фильтры живут в query-строке.
 * Проверку цепочки и экспорт (admin-only) показываем только администратору
 * (fail-closed в UI: не отрисовано, а не «серое»; Р-394).
 *
 * Доступ к самому экрану закрыт гейтом `(protected)` (middleware + layout);
 * сессию здесь перечитываем ради роли и operatorId.
 */
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  const trimmed = v?.trim();
  return trimmed ? trimmed : undefined;
}

export default async function JournalPage({ searchParams }: { searchParams: SearchParams }) {
  const operator = await getOperatorSession();
  if (!operator) redirect(LOGIN_PATH);
  const isAdmin = operator.role === 'admin';

  // Фильтры из query-строки (в том виде, как показываем в форме).
  const filters: JournalFilters = {
    operatorId: one(searchParams.operatorId),
    action: one(searchParams.action),
    subjectKind: one(searchParams.subjectKind),
    subjectId: one(searchParams.subjectId),
    from: one(searchParams.from),
    to: one(searchParams.to),
  };

  // Эффективный фильтр для запроса: голую дату `по` делаем включающей (конец дня).
  const queryFilters: JournalFilters = { ...filters };
  if (queryFilters.to && /^\d{4}-\d{2}-\d{2}$/.test(queryFilters.to)) {
    queryFilters.to = `${queryFilters.to}T23:59:59.999Z`;
  }
  if (queryFilters.from && /^\d{4}-\d{2}-\d{2}$/.test(queryFilters.from)) {
    queryFilters.from = `${queryFilters.from}T00:00:00.000Z`;
  }

  const [entries, operators, actions, subjectKinds] = await Promise.all([
    listJournalEntries({
      role: operator.role,
      selfOperatorId: operator.operatorId,
      filters: queryFilters,
    }),
    listOperatorsForFilter(),
    listDistinctActions(),
    listDistinctSubjectKinds(),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link href="/" className="text-sm text-secondary hover:text-primary">
        ← в центр управления
      </Link>

      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Журнал действий</h1>
        <p className="text-sm text-secondary">
          Неизменяемый журнал операторских действий (хеш-цепочка, Р-049).{' '}
          {isAdmin
            ? 'Вы видите все записи.'
            : 'Вы видите свои действия и общие операционные записи.'}{' '}
          Показано: {entries.length}
          {entries.length >= 500 ? ' (потолок ленты — уточните фильтр)' : ''}.
        </p>
      </div>

      <FilterBar
        filters={filters}
        operators={operators}
        actions={actions}
        subjectKinds={subjectKinds}
      />

      {isAdmin ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChainStatus />
          <ExportButton filters={queryFilters} />
        </div>
      ) : null}

      <JournalFeed entries={entries} />
    </div>
  );
}
