'use client';

import { useCallback, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  CLIENT_SORTS,
  STATE_LABELS,
  VERIFICATION_STATES,
  type ClientSort,
} from '@/lib/clients/verification-state';

/**
 * Панель поиска/фильтра/сортировки реестра (§3.1). Состояние живёт в URL
 * (searchParams) — реестр остаётся серверным, ссылку с фильтром можно
 * передать; поиск НЕ журналируется (§3.1). Контролы без клиентского стейта:
 * пишут в URL, сервер перечитывает. `useTransition` — чтобы ввод не «замерзал».
 */

const SORT_LABELS: Record<ClientSort, string> = {
  registered_desc: 'Регистрация: новые',
  registered_asc: 'Регистрация: старые',
  name_asc: 'Имя: А→Я',
  activity_desc: 'Активность: недавняя',
};

const inputCls =
  'rounded border border-border bg-base px-3 py-2 text-sm text-primary outline-none focus:border-accent';

export function Filters({
  search,
  state,
  sort,
}: {
  search: string;
  state: string;
  sort: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      startTransition(() => {
        router.replace(`${pathname}?${next.toString()}`);
      });
    },
    [params, pathname, router],
  );

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-secondary">Поиск (имя, email, id)</span>
        <input
          type="search"
          defaultValue={search}
          placeholder="например, Иванов или @mail"
          className={`${inputCls} w-64`}
          onChange={(e) => setParam('q', e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-secondary">Состояние</span>
        <select
          value={state}
          className={inputCls}
          onChange={(e) => setParam('state', e.target.value === 'all' ? '' : e.target.value)}
        >
          <option value="all">Все</option>
          {VERIFICATION_STATES.map((s) => (
            <option key={s} value={s}>
              {STATE_LABELS[s]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-secondary">Сортировка</span>
        <select
          value={sort}
          className={inputCls}
          onChange={(e) => setParam('sort', e.target.value)}
        >
          {CLIENT_SORTS.map((s) => (
            <option key={s} value={s}>
              {SORT_LABELS[s]}
            </option>
          ))}
        </select>
      </label>

      <span className="pb-2 text-xs text-secondary" aria-live="polite">
        {pending ? 'обновляю…' : ''}
      </span>
    </div>
  );
}
