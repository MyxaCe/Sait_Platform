import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button, Input } from '@broker/ui';
import { AutoSubmitSelect } from './AutoSubmitSelect';

/**
 * Фильтр-бар списка (концепция §6.1, слот `toolbar` у `DataTable`) — локальный
 * компонент зоны «Клиенты и комплаенс», кандидат в @broker/ui.
 *
 * GET-форма: значения живут в URL, работает без JS (кнопка «Применить»); с JS
 * селекты отправляют форму сами (`AutoSubmitSelect`). Поиск — 36 px, селекты
 * `compact`; «Сбросить» — только когда есть что сбрасывать. `hidden` — параметры,
 * которые фильтр должен сохранить (сортировка); страница при смене фильтра
 * всегда возвращается на первую.
 */

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterSelectSpec {
  name: string;
  label: string;
  value: string;
  options: FilterOption[];
  /** Ширина контрола (tailwind-класс), по умолчанию `w-40`. */
  width?: string;
}

export interface FilterBarProps {
  action: string;
  search?: { name: string; value: string; placeholder: string; label: string };
  selects?: FilterSelectSpec[];
  hidden?: Record<string, string | undefined>;
  /** Ссылка «Сбросить» (без фильтров); `null` — фильтров нет, кнопки нет. */
  resetHref?: string | null;
  /** Справа: короткая сводка («Найдено: 15»). */
  aside?: ReactNode;
}

export function FilterBar({ action, search, selects = [], hidden = {}, resetHref, aside }: FilterBarProps) {
  return (
    <form method="get" action={action} role="search" className="flex flex-wrap items-end gap-x-3 gap-y-2">
      {Object.entries(hidden).map(([k, v]) =>
        v ? <input key={k} type="hidden" name={k} value={v} /> : null,
      )}
      {search ? (
        <label className="flex min-w-[14rem] flex-1 flex-col gap-1 sm:max-w-xs">
          <span className="text-xs text-muted">{search.label}</span>
          <span className="relative block">
            <svg
              aria-hidden
              viewBox="0 0 16 16"
              className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 fill-none stroke-current text-muted"
            >
              <circle cx="7" cy="7" r="4.5" strokeWidth="1.5" />
              <path d="M10.5 10.5L14 14" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <Input
              type="search"
              name={search.name}
              defaultValue={search.value}
              placeholder={search.placeholder}
              controlSize="compact"
              className="pl-8"
            />
          </span>
        </label>
      ) : null}
      {selects.map((s) => (
        <label key={s.name} className="flex flex-col gap-1">
          <span className="text-xs text-muted">{s.label}</span>
          <AutoSubmitSelect name={s.name} defaultValue={s.value} className={s.width ?? 'w-40'}>
            {s.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </AutoSubmitSelect>
        </label>
      ))}
      <div className="flex items-center gap-2">
        <Button type="submit" variant="secondary" size="compact">
          Применить
        </Button>
        {resetHref ? (
          <Link
            href={resetHref}
            className="inline-flex h-9 items-center rounded-md px-2.5 text-sm text-secondary hover:bg-primary/5 hover:text-primary"
          >
            Сбросить
          </Link>
        ) : null}
      </div>
      {aside ? <div className="ml-auto self-center text-xs text-muted tabular-nums">{aside}</div> : null}
    </form>
  );
}
