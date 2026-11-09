import { DataTable, Panel, cn, type DataTableColumn } from '@broker/ui';

/**
 * Скелетоны `loading.tsx` разделов (концепция §6.1 «загрузка», аудит С10):
 * тот же каркас, что у готовой страницы (шапка → KPI → панель с таблицей /
 * карточка 2:1), чтобы при загрузке ничего не прыгало. Статичные плашки без
 * пульсации — «инструмент, не витрина» (§1). `aria-busy` + скрытая подпись
 * для скринридера.
 */

function Bar({ className }: { className?: string }) {
  return <span aria-hidden className={cn('bg-primary/[0.07] block rounded', className)} />;
}

function Header({ crumbs = false, actions = false }: { crumbs?: boolean; actions?: boolean }) {
  return (
    <div className="space-y-2">
      {crumbs ? <Bar className="h-3 w-40" /> : null}
      <div className="flex items-end justify-between gap-6">
        <div className="w-full max-w-xl space-y-2">
          <Bar className="h-6 w-56" />
          <Bar className="h-3.5 w-full" />
        </div>
        {actions ? <Bar className="h-9 w-36 rounded-md" /> : null}
      </div>
      <Bar className="h-3 w-48" />
    </div>
  );
}

function Kpis({ n = 4 }: { n?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="border-border bg-card space-y-3 rounded-lg border p-4">
          <Bar className="h-3 w-28" />
          <Bar className="h-7 w-16" />
          <Bar className="h-3 w-36" />
        </div>
      ))}
    </div>
  );
}

const COLS: DataTableColumn<never>[] = [
  { key: 'a', header: ' ', cell: () => null },
  { key: 'b', header: ' ', cell: () => null, width: '10rem' },
  { key: 'c', header: ' ', cell: () => null, width: '9rem' },
  { key: 'd', header: ' ', cell: () => null, width: '8rem' },
  { key: 'e', header: ' ', cell: () => null, width: '6rem' },
];

function TablePanel({ rows = 8, toolbar = true }: { rows?: number; toolbar?: boolean }) {
  return (
    <Panel title={<Bar className="h-4 w-40" />} flush>
      {toolbar ? (
        <div className="border-border flex flex-wrap gap-3 border-b px-4 py-3">
          <Bar className="h-9 w-64 rounded-md" />
          <Bar className="h-9 w-40 rounded-md" />
          <Bar className="h-9 w-28 rounded-md" />
        </div>
      ) : null}
      <DataTable bare columns={COLS} rows={[]} rowKey={() => ''} loadingRows={rows} />
    </Panel>
  );
}

function FormPanel({ fields = 3 }: { fields?: number }) {
  return (
    <Panel title={<Bar className="h-4 w-32" />}>
      <div className="space-y-4">
        {Array.from({ length: fields }, (_, i) => (
          <div key={i} className="space-y-1.5">
            <Bar className="h-3 w-24" />
            <Bar className="h-9 w-full rounded-md" />
          </div>
        ))}
        <Bar className="h-9 w-40 rounded-md" />
      </div>
    </Panel>
  );
}

export type PageSkeletonVariant = 'dashboard' | 'list' | 'queue' | 'card' | 'split' | 'form';

/**
 * - `dashboard` — шапка, два KPI-ряда, сетка 2:1 (очередь | лента);
 * - `list` — шапка + панель с фильтром и таблицей;
 * - `queue` — как `list`, но с KPI-рядом сверху;
 * - `card` — крошки, шапка сущности, вкладки, 2:1;
 * - `split` — таблица слева, панель/форма справа (операторы, плечо);
 * - `form` — панели настроек.
 */
export function PageSkeleton({ variant }: { variant: PageSkeletonVariant }) {
  return (
    <div className="space-y-6" aria-busy="true">
      <span className="sr-only" role="status">
        Загрузка раздела…
      </span>
      {variant === 'dashboard' ? (
        <>
          <Header />
          <Kpis />
          <Kpis />
          <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <TablePanel rows={6} toolbar={false} />
            <FormPanel fields={4} />
          </div>
        </>
      ) : null}
      {variant === 'list' ? (
        <>
          <Header actions />
          <TablePanel rows={10} />
        </>
      ) : null}
      {variant === 'queue' ? (
        <>
          <Header />
          <Kpis n={3} />
          <TablePanel rows={8} />
        </>
      ) : null}
      {variant === 'card' ? (
        <>
          <Header crumbs actions />
          <div className="border-border bg-card grid grid-cols-2 gap-4 rounded-lg border p-4 lg:grid-cols-5">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="space-y-2">
                <Bar className="h-3 w-20" />
                <Bar className="h-5 w-24" />
              </div>
            ))}
          </div>
          <div className="border-border flex gap-6 border-b pb-2.5">
            {Array.from({ length: 5 }, (_, i) => (
              <Bar key={i} className="h-4 w-20" />
            ))}
          </div>
          <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <TablePanel rows={6} toolbar={false} />
            <FormPanel />
          </div>
        </>
      ) : null}
      {variant === 'split' ? (
        <>
          <Header />
          <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <TablePanel rows={6} />
            <FormPanel fields={4} />
          </div>
        </>
      ) : null}
      {variant === 'form' ? (
        <>
          <Header />
          <div className="grid gap-5 xl:grid-cols-2">
            <FormPanel fields={4} />
            <FormPanel fields={4} />
          </div>
        </>
      ) : null}
    </div>
  );
}
