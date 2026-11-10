import Link from 'next/link';
import {
  Callout,
  DataTable,
  EmptyState,
  Money,
  PageHeader,
  Pagination,
  Panel,
  StatusBadge,
  type DataTableColumn,
} from '@broker/ui';
import { listClientRegistry, type RegistryPage, type RegistryRow } from '@/lib/clients/registry';
import {
  REGISTRY_PAGE_SIZE,
  hasRegistryFilter,
  parseRegistryQuery,
  registryHref,
  type RegistrySortKey,
} from '@/lib/clients/registry-params';
import { fmtDate, fmtDateTime } from '@/lib/ui/format';
import { FilterBar } from './_components/FilterBar';
import { AML_SHORT, ACCESS_OPTIONS, AML_OPTIONS, KYC_OPTIONS, amlKey } from './_components/compliance-labels';
// ── Менеджеры клиентов (ветка admin-managers) ──
import { requireSection } from '@/lib/auth/section-guard';
import { isClientManager, listClientManagers, type ManagerOption } from '@/lib/managers/queries';
import { canAssignManagers, managerFilterValue } from '@/lib/managers/policy';
import { BulkAssignBar, RowCheckbox, SelectAllOnPage } from './_components/managers/BulkAssignBar';

/**
 * Реестр клиентов `/clients` (ADM-02, §3.1; концепция §7.1 «страница-список»).
 * Найти клиента и сразу оценить его состояние: KYC, AML, доступ, реальный
 * счёт. Фильтры и сортировка — в URL (GET-форма и ссылки в заголовках колонок),
 * пагинация по 50 — серверная. Строка с ограничением доступа помечена полосой.
 *
 * Только чтение (`lib/clients/registry.ts`), чтение не журналируется (§3.1).
 * Доступ — operator+admin, гейт в middleware + layout `(protected)`.
 *
 * Менеджеры клиентов (ветка admin-managers): колонка «Менеджер», фильтр `?mgr=`
 * (менеджеру по умолчанию — «Мои клиенты»), у admin — чекбоксы строк и
 * массовое назначение (`BulkAssignBar`, форма связана с чекбоксами атрибутом `form`).
 */
export const dynamic = 'force-dynamic';

function accessBadges(c: RegistryRow) {
  if (!c.blocked && !c.frozen && !c.withdrawBanned) {
    return <span className="text-secondary">Активен</span>;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {c.blocked ? <StatusBadge status="blocked" /> : null}
      {c.frozen ? <StatusBadge status="frozen" /> : null}
      {c.withdrawBanned ? <StatusBadge status="withdraw_banned" /> : null}
    </span>
  );
}

function columns(
  currency: string | null,
  opts: { selectable: boolean; viewerId: string },
): DataTableColumn<RegistryRow>[] {
  const select: DataTableColumn<RegistryRow>[] = opts.selectable
    ? [
        {
          key: 'select',
          header: <SelectAllOnPage />,
          width: '2.5rem',
          cell: (c) => <RowCheckbox userId={c.userId} label={c.fullName} />,
        },
      ]
    : [];
  return [
    ...select,
    {
      key: 'name',
      header: 'Клиент',
      sortable: true,
      className: 'min-w-[8rem]',
      cell: (c) => (
        <Link href={`/clients/${c.userId}`} className="group block min-w-0 max-w-[9rem] xl:max-w-[22rem]">
          <span className="block truncate font-medium text-primary group-hover:text-accent" title={c.fullName}>
            {c.fullName}
          </span>
          <span className="block truncate text-xs text-muted" title={c.email}>
            {c.email}
          </span>
        </Link>
      ),
    },
    { key: 'kyc', header: 'KYC', width: '8.5rem', cell: (c) => <StatusBadge status={c.kyc} /> },
    {
      key: 'aml',
      header: 'AML',
      width: '8rem',
      cell: (c) => <StatusBadge status={amlKey(c.aml)} label={AML_SHORT[c.aml]} />,
    },
    { key: 'access', header: 'Доступ', width: '9.5rem', cell: accessBadges },
    {
      key: 'manager',
      header: 'Менеджер',
      width: '9rem',
      cell: (c) =>
        c.managerId === null ? (
          <span className="text-muted" title="Менеджер не закреплён">нет</span>
        ) : c.managerId === opts.viewerId ? (
          <span className="text-primary font-medium">вы</span>
        ) : (
          <span className="text-secondary block truncate" title={c.managerName ?? undefined}>
            {c.managerName}
          </span>
        ),
    },
    {
      key: 'balance',
      header: currency ? `Реальный счёт, ${currency}` : 'Реальный счёт',
      sortable: true,
      numeric: true,
      width: '9rem',
      cell: (c) => (
        <Money minor={c.balanceMinor} currency={c.currency ?? 'USDT'} hideCurrency={currency !== null} />
      ),
    },
    {
      key: 'registered',
      header: 'Регистрация',
      sortable: true,
      numeric: true,
      align: 'left',
      width: '7.5rem',
      className: 'hidden xl:table-cell',
      cell: (c) => <span className="text-secondary">{fmtDate(c.registeredAt)}</span>,
    },
    {
      key: 'activity',
      header: 'Последний вход',
      sortable: true,
      numeric: true,
      align: 'left',
      width: '9.5rem',
      className: 'hidden xl:table-cell',
      cell: (c) =>
        c.lastLoginAt ? (
          <span className="text-secondary">{fmtDateTime(c.lastLoginAt)}</span>
        ) : (
          <span className="text-muted">никогда</span>
        ),
    },
    {
      key: 'go',
      header: <span className="sr-only">Действие</span>,
      align: 'right',
      width: '5rem',
      className: 'relative hidden xl:table-cell',
      cell: (c) => (
        <Link href={`/clients/${c.userId}`} className="text-[13px] font-medium text-accent hover:underline">
          Открыть
        </Link>
      ),
    },
  ];
}

export default async function ClientsRegistryPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const operator = await requireSection('clients');
  // Менеджер клиентов открывает реестр на «Моих клиентах»; «Все» — одним выбором.
  let viewerIsManager = false;
  let managers: ManagerOption[] = [];
  try {
    [viewerIsManager, managers] = await Promise.all([
      isClientManager(operator.operatorId),
      listClientManagers(),
    ]);
  } catch (error) {
    console.error('[clients] менеджеры не прочитаны', error instanceof Error ? error.message : error);
  }
  const query = parseRegistryQuery(searchParams, { defaultMine: viewerIsManager });
  const filtered = hasRegistryFilter(query);
  const canAssign = canAssignManagers(operator.role);

  let data: RegistryPage | null = null;
  try {
    data = await listClientRegistry(query, undefined, operator.operatorId);
  } catch (error) {
    console.error('[clients] реестр не прочитан', error instanceof Error ? error.message : error);
  }

  const mgrOptions = [
    { value: 'all', label: 'Все клиенты' },
    ...(viewerIsManager ? [{ value: 'mine', label: 'Мои клиенты' }] : []),
    { value: 'none', label: 'Без менеджера' },
    ...managers
      .filter((m) => m.id !== operator.operatorId)
      .map((m) => ({ value: m.id, label: `${m.displayName} (${m.clients})` })),
  ];
  const mineView = query.mgr === 'mine';

  // Валюта в заголовке колонки, если на странице она одна (концепция §4.2).
  const currencies = new Set((data?.rows ?? []).filter((r) => r.balanceMinor !== null).map((r) => r.currency));
  const currency = currencies.size === 1 ? ([...currencies][0] ?? null) : null;

  const sortHref = (key: string, dir: 'asc' | 'desc') =>
    registryHref(query, { sort: key as RegistrySortKey, dir, page: 1 });

  return (
    <div className="space-y-5">
      <PageHeader
        title={mineView ? 'Мои клиенты' : 'Клиенты'}
        description={
          mineView
            ? 'Клиенты, закреплённые за вами как за менеджером. Все клиенты платформы — фильтр «Менеджер».'
            : 'Реестр клиентов платформы: верификация, AML, доступ, менеджер и реальный счёт.'
        }
        meta={
          data ? (
            <span className="tabular-nums">
              {filtered ? 'Найдено' : 'Всего'}: {data.total.toLocaleString('ru-RU')} · срез на{' '}
              {fmtDateTime(new Date())}
            </span>
          ) : null
        }
      />

      {data === null ? (
        <Callout tone="negative" title="Реестр не загрузился">
          База платформы не ответила на запрос. Данные клиентов не показаны, чтобы не вводить в
          заблуждение неполным списком. Обновите страницу; если повторяется — проверьте здоровье
          платформы.
        </Callout>
      ) : (
        <Panel flush>
          <DataTable
            bare
            aria-label="Реестр клиентов"
            columns={columns(currency, { selectable: canAssign, viewerId: operator.operatorId })}
            rows={data.rows}
            rowKey={(c) => c.userId}
            rowTone={(c) => (c.blocked || c.frozen || c.withdrawBanned ? 'negative' : undefined)}
            sort={{ key: query.sort, dir: query.dir, hrefFor: sortHref, linkComponent: Link }}
            toolbar={
              <>
              {canAssign && data.rows.length > 0 ? <BulkAssignBar managers={managers} /> : null}
              <FilterBar
                action="/clients"
                search={{ name: 'q', value: query.q, label: 'Поиск', placeholder: 'Имя, email или id' }}
                selects={[
                  { name: 'kyc', label: 'KYC', value: query.kyc, options: KYC_OPTIONS },
                  { name: 'aml', label: 'AML', value: query.aml, options: AML_OPTIONS },
                  { name: 'access', label: 'Доступ', value: query.access, options: ACCESS_OPTIONS },
                  { name: 'mgr', label: 'Менеджер', value: managerFilterValue(query.mgr), options: mgrOptions, width: 'w-48' },
                ]}
                hidden={
                  query.sort === 'registered' && query.dir === 'desc'
                    ? {}
                    : { sort: query.sort, dir: query.dir }
                }
                resetHref={
                  filtered
                    ? registryHref(query, { q: '', kyc: 'all', aml: 'all', access: 'all', mgr: query.mgrDefault, page: 1 })
                    : null
                }
              />
              </>
            }
            footer={
              data.total > 0 ? (
                <Pagination
                  page={query.page}
                  pageSize={REGISTRY_PAGE_SIZE}
                  total={data.total}
                  hrefFor={(page) => registryHref(query, { page })}
                  linkComponent={Link}
                />
              ) : undefined
            }
            empty={
              filtered || query.page > 1 ? (
                mineView && !filtered ? (
                <EmptyState
                  size="compact"
                  title="За вами пока не закреплено ни одного клиента"
                  description="Клиентов закрепляет администратор — в карточке клиента или массово из реестра."
                  action={
                    <Link
                      href={registryHref(query, { mgr: 'all', page: 1 })}
                      className="inline-flex h-9 items-center rounded-md border border-border-strong px-3.5 text-sm text-primary hover:bg-primary/5"
                    >
                      Все клиенты
                    </Link>
                  }
                />
                ) : (
                <EmptyState
                  size="compact"
                  title="Ничего не найдено"
                  description="Ни один клиент не подходит под поиск и фильтры."
                  action={
                    <Link
                      href={registryHref(query, { q: '', kyc: 'all', aml: 'all', access: 'all', mgr: query.mgrDefault, page: 1 })}
                      className="inline-flex h-9 items-center rounded-md border border-border-strong px-3.5 text-sm text-primary hover:bg-primary/5"
                    >
                      Сбросить фильтр
                    </Link>
                  }
                />
                )
              ) : (
                <EmptyState
                  size="compact"
                  title="Клиентов пока нет"
                  description="Клиенты появятся здесь после регистрации в кабинете."
                />
              )
            }
          />
        </Panel>
      )}
    </div>
  );
}
