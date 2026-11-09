import Link from 'next/link';
import {
  Callout,
  DataTable,
  EmptyState,
  KpiTile,
  PageHeader,
  Panel,
  StatusBadge,
  type DataTableColumn,
} from '@broker/ui';
import {
  getAmlCounts,
  listAmlRows,
  parseAmlListQuery,
  type AmlCounts,
  type AmlListRow,
} from '@/lib/aml/worklist-view';
import { sanctionsListLabel } from '@/lib/aml/lists';
import { fmtAge, fmtDate, fmtDateTime } from '@/lib/ui/format';
import { FilterBar } from '../clients/_components/FilterBar';
import { AML_OPTIONS, AML_SHORT, amlKey } from '../clients/_components/compliance-labels';

/**
 * Рабочий список AML-скрининга `/aml` (ADM-14, Р-454 I-5; концепция §7.1).
 * Сверху — требующие внимания: эскалации, затем не сверявшиеся, затем чистые.
 * Скрининг РУЧНОЙ: оператор сверяет во внешних источниках (OFSI/OFAC/EU, PEP)
 * и фиксирует результат в карточке клиента — `/aml/[userId]`.
 *
 * Только чтение (`lib/aml/worklist-view.ts`). Доступ operator+admin — гейт
 * layout `(protected)` + middleware.
 */
export const dynamic = 'force-dynamic';

const ACTION_LABEL: Record<AmlListRow['status'], string> = {
  escalated: 'Разобрать',
  unscreened: 'Сверить',
  clear: 'Открыть',
};

const COLUMNS: DataTableColumn<AmlListRow>[] = [
  {
    key: 'client',
    header: 'Клиент',
    className: 'min-w-[12rem]',
    cell: (r) => (
      <Link href={`/aml/${r.userId}`} className="group block min-w-0 max-w-[13rem] xl:max-w-[22rem]">
        <span className="block truncate font-medium text-primary group-hover:text-accent" title={r.fullName}>
          {r.fullName}
        </span>
        <span className="block truncate text-xs text-muted" title={r.email}>
          {r.email}
        </span>
      </Link>
    ),
  },
  {
    key: 'status',
    header: 'AML',
    width: '8.5rem',
    cell: (r) => <StatusBadge status={amlKey(r.status)} label={AML_SHORT[r.status]} />,
  },
  {
    key: 'screened',
    header: 'Последняя сверка',
    numeric: true,
    align: 'left',
    width: '10rem',
    cell: (r) =>
      r.screenedAt ? (
        <span className="block leading-tight">
          <span className="block text-secondary">{fmtDateTime(r.screenedAt)}</span>
          <span className="block truncate text-xs text-muted">{r.screenedByName ?? '—'}</span>
        </span>
      ) : (
        <span className="block leading-tight">
          <span className="block text-muted">не сверялся</span>
          <span className="block text-xs text-muted">клиент с {fmtDate(r.registeredAt)}</span>
        </span>
      ),
  },
  {
    key: 'lists',
    header: 'Списки',
    className: 'hidden whitespace-nowrap xl:table-cell',
    cell: (r) =>
      r.lists.length ? (
        <span className="text-secondary">{r.lists.map(sanctionsListLabel).join(' · ')}</span>
      ) : (
        <span className="text-muted">—</span>
      ),
  },
  { key: 'kyc', header: 'KYC', width: '8.5rem', className: 'hidden xl:table-cell', cell: (r) => <StatusBadge status={r.kyc} /> },
  {
    key: 'access',
    header: 'Доступ',
    width: '9rem',
    cell: (r) => (r.blocked ? <StatusBadge status="blocked" /> : <span className="text-secondary">Активен</span>),
  },
  {
    key: 'go',
    header: <span className="sr-only">Действие</span>,
    align: 'right',
    className: 'relative',
    width: '6.5rem',
    cell: (r) => (
      <Link href={`/aml/${r.userId}`} className="text-[13px] font-medium text-accent hover:underline">
        {ACTION_LABEL[r.status]}
      </Link>
    ),
  },
];

function FilterLink({ href }: { href: string }) {
  return (
    <Link href={href} className="font-medium text-accent hover:underline">
      Показать →
    </Link>
  );
}

export default async function AmlWorklistPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const query = parseAmlListQuery(searchParams);
  const filtered = query.status !== 'all' || query.q !== '';

  let rows: AmlListRow[] | null = null;
  let counts: AmlCounts | null = null;
  try {
    [rows, counts] = await Promise.all([listAmlRows(query), getAmlCounts()]);
  } catch (error) {
    console.error('[aml] рабочий список не прочитан', error instanceof Error ? error.message : error);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="AML-скрининг"
        description="Ручная сверка клиентов по санкционным спискам (OFSI, OFAC, EU consolidated) и PEP. Сверка — во внешних источниках, здесь фиксируется результат с основанием."
        meta={<span className="tabular-nums">Срез на {fmtDateTime(new Date())}</span>}
      />

      {rows === null || counts === null ? (
        <Callout tone="negative" title="Рабочий список не загрузился">
          База платформы не ответила. Список не показан, чтобы пустой экран не приняли за «эскалаций
          нет». Обновите страницу.
        </Callout>
      ) : (
        <>
          <section aria-label="Сводка AML" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile
              label="Эскалации"
              value={counts.escalated}
              tone={counts.escalated > 0 ? 'negative' : 'default'}
              hint={counts.escalated > 0 ? 'найдено совпадение' : 'совпадений нет'}
              action={counts.escalated > 0 ? <FilterLink href="/aml?status=escalated" /> : undefined}
            />
            <KpiTile
              label="Не сверялись"
              value={counts.unscreened}
              tone={counts.unscreened > 0 ? 'warning' : 'default'}
              hint={counts.unscreened > 0 ? 'ждут первой сверки' : 'все сверены'}
              action={counts.unscreened > 0 ? <FilterLink href="/aml?status=unscreened" /> : undefined}
            />
            <KpiTile
              label="Чисто"
              value={counts.clear}
              hint={`из ${counts.total} в рабочем списке`}
              action={counts.clear > 0 ? <FilterLink href="/aml?status=clear" /> : undefined}
            />
            <KpiTile
              label="Давность сверки"
              value={counts.oldestClearAt ? fmtAge(counts.oldestClearAt) : '—'}
              hint={counts.oldestClearAt ? 'самая давняя среди «чисто»' : 'чистых сверок ещё нет'}
            />
          </section>

          <Panel
            title="Рабочий список"
            count={rows.length}
            description="Эскалации и не сверявшиеся — сверху."
            flush
          >
            <DataTable
              bare
              aria-label="AML: рабочий список клиентов"
              columns={COLUMNS}
              rows={rows}
              rowKey={(r) => r.userId}
              rowTone={(r) => (r.status === 'escalated' ? 'negative' : r.status === 'unscreened' ? 'warning' : undefined)}
              toolbar={
                <FilterBar
                  action="/aml"
                  search={{ name: 'q', value: query.q, label: 'Поиск', placeholder: 'Имя, email или id' }}
                  selects={[{ name: 'status', label: 'Статус AML', value: query.status, options: AML_OPTIONS }]}
                  resetHref={filtered ? '/aml' : null}
                />
              }
              empty={
                filtered ? (
                  <EmptyState
                    size="compact"
                    title="Ничего не найдено"
                    description="Ни один клиент не подходит под поиск и статус."
                    action={
                      <Link
                        href="/aml"
                        className="inline-flex h-9 items-center rounded-md border border-border-strong px-3.5 text-sm text-primary hover:bg-primary/5"
                      >
                        Сбросить фильтр
                      </Link>
                    }
                  />
                ) : (
                  <EmptyState
                    size="compact"
                    title="Клиентов для сверки нет"
                    description="В рабочий список попадают клиенты, начавшие верификацию. Пока таких нет."
                  />
                )
              }
            />
          </Panel>
        </>
      )}
    </div>
  );
}
