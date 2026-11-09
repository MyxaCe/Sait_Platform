import type { ElementType, ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * Одна колонка таблицы. `cell` рисует ячейку из строки — ссылку, бейдж,
 * `<Money>` и т.п. кладёт сюда родитель (DataTable не знает про навигацию,
 * остаётся server-safe и без next-зависимостей).
 */
export interface DataTableColumn<Row> {
  key: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  align?: 'left' | 'right' | 'center';
  /** `true` — числовая колонка: `tabular-nums` + выравнивание вправо. */
  numeric?: boolean;
  /** `true` — машинная строка (хэш/адрес/id): моноширинный шрифт. */
  mono?: boolean;
  /** Колонка сортируется (заголовок становится ссылкой, см. `sort`). */
  sortable?: boolean;
  /** CSS-ширина ячейки (напр. '8rem', '20%'). */
  width?: string;
  className?: string;
}

export interface DataTableSort {
  /** Ключ текущей колонки сортировки. */
  key: string;
  dir: 'asc' | 'desc';
  /** Ссылка для клика по заголовку (серверная сортировка через URL). */
  hrefFor: (key: string, dir: 'asc' | 'desc') => string;
  /** Компонент ссылки (next/link); по умолчанию `<a>`. */
  linkComponent?: ElementType;
}

export interface DataTableProps<Row> {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  /** Подсвеченная строка (выбранная). */
  selectedKey?: string;
  /** Тон строки (напр. заблокированный клиент) — тонкая полоса слева. */
  rowTone?: (row: Row) => 'negative' | 'warning' | undefined;
  /** Слот фильтр-бара над таблицей. */
  toolbar?: ReactNode;
  /** Слот под таблицей (пагинация/итоги). */
  footer?: ReactNode;
  /** Пустое состояние — явное, не «сломалось». Строка или `<EmptyState>`. */
  empty?: ReactNode;
  /** Серверная сортировка через URL. */
  sort?: DataTableSort;
  /** `compact` — 32px строки (вложенные таблицы); `default` — 40px. */
  density?: 'default' | 'compact';
  /** Число строк-скелетов: показывается вместо данных (loading.tsx). */
  loadingRows?: number;
  /** Без собственной рамки — когда таблица лежит внутри `Panel`. */
  bare?: boolean;
  className?: string;
  'aria-label'?: string;
}

const ALIGN: Record<'left' | 'right' | 'center', string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
};

function colClass<Row>(col: DataTableColumn<Row>): string {
  const align = col.align ?? (col.numeric ? 'right' : 'left');
  return cn(
    ALIGN[align],
    col.numeric && 'whitespace-nowrap tabular-nums',
    col.mono && 'whitespace-nowrap font-mono text-[12.5px]',
    col.className,
  );
}

function SortGlyph({ dir }: { dir: 'asc' | 'desc' | null }) {
  return (
    <svg viewBox="0 0 8 12" aria-hidden className="ml-1 inline-block h-3 w-2 align-[-1px]">
      <path
        d="M4 1L7 4.5H1z"
        className={dir === 'asc' ? 'fill-current' : 'fill-current opacity-30'}
      />
      <path
        d="M4 11L1 7.5h6z"
        className={dir === 'desc' ? 'fill-current' : 'fill-current opacity-30'}
      />
    </svg>
  );
}

/**
 * `DataTable` — плотная операторская таблица (концепция §6.1). Шапка — мелкий
 * спокойный текст на `elevated`, строки 40px с тонкими разделителями, ховер,
 * числа справа табличными цифрами, машинные строки моноширинным. Сортировка —
 * серверная, через ссылки в заголовках (`sort`), пагинация — в `footer`
 * (`<Pagination>`). Презентационный и server-safe.
 */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  selectedKey,
  rowTone,
  toolbar,
  footer,
  empty,
  sort,
  density = 'default',
  loadingRows,
  bare = false,
  className,
  'aria-label': ariaLabel,
}: DataTableProps<Row>) {
  const cellPad = density === 'compact' ? 'px-3 py-1.5' : 'px-3 py-2.5';
  const Link = sort?.linkComponent ?? 'a';
  const loading = loadingRows != null && loadingRows > 0;

  return (
    <div
      className={cn(
        'overflow-hidden',
        !bare && 'border-border bg-card rounded-lg border',
        className,
      )}
    >
      {toolbar ? <div className="border-border border-b px-3 py-2.5">{toolbar}</div> : null}

      {!loading && rows.length === 0 ? (
        <div className="text-secondary px-4 py-10 text-center text-sm">
          {empty ?? 'Записей нет.'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table
            className="w-full border-collapse text-[13px]"
            aria-label={ariaLabel}
            aria-busy={loading || undefined}
          >
            <thead>
              <tr className="border-border bg-elevated/60 border-b">
                {columns.map((col) => {
                  const active = sort && sort.key === col.key ? sort.dir : null;
                  const next: 'asc' | 'desc' = active === 'desc' ? 'asc' : 'desc';
                  return (
                    <th
                      key={col.key}
                      scope="col"
                      aria-sort={
                        active ? (active === 'asc' ? 'ascending' : 'descending') : undefined
                      }
                      style={col.width ? { width: col.width } : undefined}
                      className={cn(
                        colClass(col),
                        'text-secondary whitespace-nowrap px-3 py-2 font-sans text-xs font-medium',
                      )}
                    >
                      {sort && col.sortable ? (
                        <Link
                          href={sort.hrefFor(col.key, next)}
                          className={cn('hover:text-primary', active && 'text-primary')}
                        >
                          {col.header}
                          <SortGlyph dir={active} />
                        </Link>
                      ) : (
                        col.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: loadingRows }, (_, i) => (
                    <tr key={`sk-${i}`} className="border-border border-b last:border-0">
                      {columns.map((col) => (
                        <td key={col.key} className={cellPad}>
                          <span className="bg-primary/[0.07] block h-3.5 w-3/4 rounded" />
                        </td>
                      ))}
                    </tr>
                  ))
                : rows.map((row) => {
                    const key = rowKey(row);
                    const selected = selectedKey != null && key === selectedKey;
                    const tone = rowTone?.(row);
                    return (
                      <tr
                        key={key}
                        aria-selected={selected || undefined}
                        className={cn(
                          'border-border border-b last:border-0',
                          selected ? 'bg-accent/[0.08]' : 'hover:bg-primary/[0.03]',
                        )}
                      >
                        {columns.map((col, i) => (
                          <td
                            key={col.key}
                            className={cn(
                              cellPad,
                              'text-primary align-middle',
                              colClass(col),
                              i === 0 && tone && 'relative',
                            )}
                          >
                            {i === 0 && tone ? (
                              <span
                                aria-hidden
                                className={cn(
                                  'absolute inset-y-1.5 left-0 w-0.5 rounded-r',
                                  tone === 'negative' ? 'bg-negative' : 'bg-warning',
                                )}
                              />
                            ) : null}
                            {col.cell(row)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>
      )}

      {footer ? <div className="border-border border-t px-3 py-2">{footer}</div> : null}
    </div>
  );
}
