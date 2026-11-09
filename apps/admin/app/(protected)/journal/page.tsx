import Link from 'next/link';
import { redirect } from 'next/navigation';
import { EmptyState, PageHeader, Pagination, Panel } from '@broker/ui';
import { getOperatorSession } from '@/lib/auth/current';
import { LOGIN_PATH } from '@/lib/auth/constants';
import {
  STATIC_SUBJECT_NAMES,
  actionLabel,
  basisOf,
  subjectKindLabel,
} from '@/lib/journal/labels';
import { fmtDateTime } from '@/lib/ui/format';
import {
  countJournalEntries,
  getJournalTotals,
  listDistinctActions,
  listJournalEntries,
  listOperatorsForFilter,
  resolveSubjectNames,
  type JournalFilters,
} from './queries';
import { FilterBar } from './_components/FilterBar';
import { JournalFeed, type JournalViewRow } from './_components/JournalFeed';
import { ChainStatus } from './_components/ChainStatus';
import { ExportButton } from './_components/ExportButton';

/**
 * Журнал/аудит `/journal` (ADM-06, § 3.10; концепция §7.1).
 *
 * Серверный компонент: читает журнал напрямую из базы под роль-видимость
 * (operator — свои + общие; admin — все). Фильтры и страница живут в URL.
 * Проверку цепочки и выгрузку (admin-only) показываем только администратору
 * (fail-closed в UI: не отрисовано, а не «серое»; Р-394).
 *
 * Доступ к самому экрану закрыт гейтом `(protected)` (middleware + layout);
 * сессию здесь перечитываем ради роли и operatorId.
 */
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

type SearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  const trimmed = v?.trim();
  return trimmed ? trimmed : undefined;
}

function hrefWith(filters: JournalFilters, page?: number): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
  if (page && page > 1) q.set('page', String(page));
  const s = q.toString();
  return s ? `/journal?${s}` : '/journal';
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
  const active = Object.values(filters).some(Boolean);
  const requestedPage = Math.max(1, Math.floor(Number(one(searchParams.page) ?? '1')) || 1);

  // Эффективный фильтр для запроса: голую дату `по` делаем включающей (конец дня).
  const queryFilters: JournalFilters = { ...filters };
  if (queryFilters.to && /^\d{4}-\d{2}-\d{2}$/.test(queryFilters.to)) {
    queryFilters.to = `${queryFilters.to}T23:59:59.999Z`;
  }
  if (queryFilters.from && /^\d{4}-\d{2}-\d{2}$/.test(queryFilters.from)) {
    queryFilters.from = `${queryFilters.from}T00:00:00.000Z`;
  }

  const scope = { role: operator.role, selfOperatorId: operator.operatorId, filters: queryFilters };
  const [total, totals, operators, actions] = await Promise.all([
    countJournalEntries(scope),
    getJournalTotals(),
    listOperatorsForFilter(),
    listDistinctActions(),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, pages);
  const entries = await listJournalEntries({
    ...scope,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const subjectFilter =
    filters.subjectId && filters.subjectKind
      ? { kind: filters.subjectKind, id: filters.subjectId }
      : null;
  const names = await resolveSubjectNames([
    ...entries,
    ...(subjectFilter ? [{ subjectKind: subjectFilter.kind, subjectId: subjectFilter.id }] : []),
  ]);

  const rows: JournalViewRow[] = entries.map((e) => {
    const a = actionLabel(e.action);
    const key = `${e.subjectKind}:${e.subjectId}`;
    const name = names.get(key) ?? STATIC_SUBJECT_NAMES[key] ?? null;
    return {
      seq: e.seq,
      time: fmtDateTime(e.occurredAt),
      occurredAt: e.occurredAt,
      action: e.action,
      label: a.label,
      tone: a.tone,
      basis: basisOf(e.payload),
      operatorName: e.operatorName,
      operatorLogin: e.operatorLogin,
      subjectKind: e.subjectKind,
      subjectKindLabel: subjectKindLabel(e.subjectKind),
      subjectId: e.subjectId,
      subjectName: name,
      subjectHref: e.subjectKind === 'client' && name ? `/clients/${e.subjectId}` : null,
      subjectJournalHref: hrefWith({ subjectKind: e.subjectKind, subjectId: e.subjectId }),
      payload: e.payload,
      entryHash: e.entryHash,
      prevHash: e.prevHash,
    };
  });

  const subjectName = subjectFilter
    ? (names.get(`${subjectFilter.kind}:${subjectFilter.id}`) ?? null)
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Журнал действий"
        description="Неизменяемая запись каждого действия операторов: кто, когда, над кем и на каком основании."
        meta={
          <span className="tabular-nums">
            Срез на {fmtDateTime(new Date())} ·{' '}
            {isAdmin
              ? 'вам видны все записи'
              : 'вам видны ваши действия и общие записи о клиентах, деньгах и плече'}
          </span>
        }
      />

      <div className={isAdmin ? 'grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]' : undefined}>
        <ChainStatus
          total={totals.total}
          lastSeq={totals.lastSeq}
          lastAt={totals.lastAt ? fmtDateTime(totals.lastAt) : null}
          canVerify={isAdmin}
        />
        {isAdmin ? <ExportButton filters={queryFilters} count={total} /> : null}
      </div>

      <Panel
        title="Записи"
        count={total.toLocaleString('ru-RU')}
        description={active ? 'По фильтру · новые сверху' : 'Новые сверху · раскройте строку, чтобы увидеть payload и хеши'}
        flush
      >
        <div className="border-border space-y-2.5 border-b px-4 py-3">
          <FilterBar filters={filters} operators={operators} actions={actions} active={active} />
          {subjectFilter ? (
            <p className="text-secondary flex flex-wrap items-center gap-2 text-[13px]">
              Только записи по субъекту:
              <span className="bg-primary/[0.06] text-primary ring-border-strong inline-flex h-[24px] items-center gap-1.5 rounded-md px-2 text-xs font-medium ring-1 ring-inset">
                {subjectKindLabel(subjectFilter.kind)} · {subjectName ?? subjectFilter.id}
              </span>
              <Link
                href={hrefWith({ ...filters, subjectKind: undefined, subjectId: undefined })}
                className="text-accent text-xs font-medium hover:underline"
              >
                Снять
              </Link>
            </p>
          ) : null}
        </div>

        {rows.length === 0 ? (
          active ? (
            <EmptyState
              size="compact"
              title="Ничего не найдено"
              description="По этому фильтру записей нет. Измените период или тип действия."
              action={
                <Link href="/journal" className="text-accent text-sm font-medium hover:underline">
                  Сбросить фильтр
                </Link>
              }
            />
          ) : (
            <EmptyState
              size="compact"
              title="Журнал пока пуст"
              description="Записи появятся с первым действием оператора."
            />
          )
        ) : (
          <JournalFeed rows={rows} />
        )}

        {total > 0 ? (
          <div className="border-border border-t px-3 py-2">
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={total}
              hrefFor={(p) => hrefWith(filters, p)}
              linkComponent={Link}
            />
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
