import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * Одна колонка таблицы-очереди. `cell` рисует ячейку из строки — ссылку,
 * бейдж, индикатор lock'а и т.п. кладёт сюда родитель (DataTable сам не знает
 * про навигацию, остаётся server-safe и без next-зависимостей).
 */
export interface DataTableColumn<Row> {
  key: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  align?: 'left' | 'right' | 'center';
  /** `true` — числовая колонка: `tabular-nums` + выравнивание вправо. */
  numeric?: boolean;
  /** CSS-ширина ячейки (напр. '8rem', '20%'). */
  width?: string;
  className?: string;
}

export interface DataTableProps<Row> {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  /** Подсвеченная строка (выбранная) — `royal`. */
  selectedKey?: string;
  /** Слот фильтр-бара над таблицей. */
  toolbar?: ReactNode;
  /** Слот под таблицей (пагинация/итоги). */
  footer?: ReactNode;
  /** Что показать при пустом наборе — явное пустое состояние, не «сломалось». */
  empty?: ReactNode;
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
  return cn(ALIGN[align], col.numeric && 'tabular-nums', col.className);
}

/**
 * `DataTable` — плотная таблица-очередь (§5.3 п.1). Компактные строки, zebra
 * через `card`, выделенная строка через `royal`, явное пустое состояние,
 * слоты под фильтр-бар и пагинацию. Презентационный и server-safe: сортировку/
 * фильтрацию/пагинацию делает родитель (серверный компонент), сюда приходят
 * готовые строки. Основа очередей KYC/клиентов/денег/журнала.
 */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  selectedKey,
  toolbar,
  footer,
  empty,
  className,
  'aria-label': ariaLabel,
}: DataTableProps<Row>) {
  return (
    <div className={cn('overflow-hidden rounded-lg border border-border bg-elevated', className)}>
      {toolbar ? <div className="border-b border-border px-3 py-2">{toolbar}</div> : null}

      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-secondary">
          {empty ?? 'Записей нет.'}
        </div>
      ) : (
        <table className="w-full border-collapse text-sm" aria-label={ariaLabel}>
          <thead>
            <tr className="border-b border-border text-left">
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  style={col.width ? { width: col.width } : undefined}
                  className={cn(
                    'px-3 py-2 text-xs font-medium uppercase tracking-wide text-secondary',
                    colClass(col),
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = rowKey(row);
              const selected = selectedKey != null && key === selectedKey;
              return (
                <tr
                  key={key}
                  aria-selected={selected || undefined}
                  className={cn(
                    'border-b border-border/60 last:border-0',
                    selected ? 'bg-royal/30' : 'odd:bg-card/40 hover:bg-accent/5',
                  )}
                >
                  {columns.map((col) => (
                    <td key={col.key} className={cn('px-3 py-2 text-primary', colClass(col))}>
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {footer ? <div className="border-t border-border px-3 py-2">{footer}</div> : null}
    </div>
  );
}
