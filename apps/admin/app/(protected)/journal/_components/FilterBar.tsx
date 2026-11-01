import Link from 'next/link';
import { Button, Input, Select } from '@broker/ui';
import type { JournalFilters, OperatorOption } from '../queries';

/**
 * Фильтр-бар журнала (ADM-06): оператор, тип действия, субъект, период.
 * Обычная GET-форма — фильтры живут в query-строке, страница сервер-рендерится
 * под них (никакой клиентской логики, лента остаётся серверной). «Сбросить» —
 * просто ссылка на `/journal` без параметров.
 */
export function FilterBar({
  filters,
  operators,
  actions,
  subjectKinds,
}: {
  filters: JournalFilters;
  operators: OperatorOption[];
  actions: string[];
  subjectKinds: string[];
}) {
  return (
    <form
      method="get"
      className="grid grid-cols-1 gap-3 rounded border border-border bg-elevated p-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <label className="flex flex-col gap-1 text-xs text-secondary">
        Оператор
        <Select name="operatorId" defaultValue={filters.operatorId ?? ''}>
          <option value="">— любой —</option>
          {operators.map((o) => (
            <option key={o.id} value={o.id}>
              {o.displayName} ({o.login})
            </option>
          ))}
        </Select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-secondary">
        Тип действия
        <Select name="action" defaultValue={filters.action ?? ''}>
          <option value="">— любое —</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-secondary">
        Род субъекта
        <Select name="subjectKind" defaultValue={filters.subjectKind ?? ''}>
          <option value="">— любой —</option>
          {subjectKinds.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </Select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-secondary">
        Субъект (id)
        <Input name="subjectId" defaultValue={filters.subjectId ?? ''} placeholder="точный id субъекта" />
      </label>

      <label className="flex flex-col gap-1 text-xs text-secondary">
        Период с
        <Input type="date" name="from" defaultValue={filters.from ?? ''} />
      </label>

      <label className="flex flex-col gap-1 text-xs text-secondary">
        Период по
        <Input type="date" name="to" defaultValue={filters.to ?? ''} />
      </label>

      <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
        <Button type="submit" size="sm">
          Применить фильтр
        </Button>
        <Link
          href="/journal"
          className="inline-flex min-h-[40px] items-center rounded-xl border border-border bg-card px-4 text-sm text-primary hover:bg-elevated"
        >
          Сбросить
        </Link>
      </div>
    </form>
  );
}
