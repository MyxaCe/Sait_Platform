import Link from 'next/link';
import { Button, Input, Select } from '@broker/ui';
import { ACTION_GROUPS, ACTION_LABELS, actionGroup } from '@/lib/journal/labels';
import type { JournalFilters, OperatorOption } from '../queries';

/**
 * Фильтр журнала (ADM-06, концепция §6.1 toolbar): оператор, тип действия
 * (человеческие подписи, сгруппированные по областям), период. Обычная
 * GET-форма — фильтры живут в URL, лента серверная, работает без JS. Субъект
 * (из ссылки «все записи по субъекту») сохраняется скрытыми полями и
 * показывается снаружи как снимаемый фильтр. Смена фильтра сбрасывает страницу.
 */

const label = 'text-secondary text-xs font-medium';

export function FilterBar({
  filters,
  operators,
  actions,
  active,
}: {
  filters: JournalFilters;
  operators: OperatorOption[];
  actions: string[];
  /** Есть ли хоть один фильтр — показать «Сбросить». */
  active: boolean;
}) {
  // Типы действий: известные — по группам словаря, неизвестные — «Прочее» кодом.
  const known = new Set(actions.filter((a) => ACTION_LABELS[a]));
  const unknown = actions.filter((a) => !ACTION_LABELS[a]);

  return (
    <form method="get" className="flex flex-wrap items-end gap-x-3 gap-y-2.5" role="search">
      {filters.subjectKind ? <input type="hidden" name="subjectKind" value={filters.subjectKind} /> : null}
      {filters.subjectId ? <input type="hidden" name="subjectId" value={filters.subjectId} /> : null}

      <label className="flex w-full flex-col gap-1.5 sm:w-52">
        <span className={label}>Оператор</span>
        <Select name="operatorId" controlSize="compact" defaultValue={filters.operatorId ?? ''}>
          <option value="">Все операторы</option>
          {operators.map((o) => (
            <option key={o.id} value={o.id}>
              {o.displayName} · {o.login}
            </option>
          ))}
        </Select>
      </label>

      <label className="flex w-full flex-col gap-1.5 sm:w-72">
        <span className={label}>Тип действия</span>
        <Select name="action" controlSize="compact" defaultValue={filters.action ?? ''}>
          <option value="">Все действия</option>
          {ACTION_GROUPS.map((g) => {
            const items = [...known].filter((a) => actionGroup(a) === g.key);
            if (items.length === 0) return null;
            return (
              <optgroup key={g.key} label={g.label}>
                {items.map((a) => (
                  <option key={a} value={a}>
                    {ACTION_LABELS[a]!.label}
                  </option>
                ))}
              </optgroup>
            );
          })}
          {unknown.length > 0 ? (
            <optgroup label="Прочее">
              {unknown.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </optgroup>
          ) : null}
        </Select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={label}>С даты</span>
        <Input
          type="date"
          name="from"
          controlSize="compact"
          defaultValue={filters.from ?? ''}
          className="w-40 tabular-nums"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={label}>По дату</span>
        <Input
          type="date"
          name="to"
          controlSize="compact"
          defaultValue={filters.to ?? ''}
          className="w-40 tabular-nums"
        />
      </label>

      <div className="flex items-center gap-2">
        <Button type="submit" size="compact" variant="secondary">
          Применить
        </Button>
        {active ? (
          <Link
            href="/journal"
            className="text-secondary hover:text-primary inline-flex h-9 items-center px-2 text-sm"
          >
            Сбросить
          </Link>
        ) : null}
      </div>
    </form>
  );
}
