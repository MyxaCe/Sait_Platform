import { Button, initialsOf } from '@broker/ui';
import { logoutAction } from '@/lib/auth/logout';
import type { OperatorRole, OperatorSession } from '@/lib/auth/session';
import { HealthIndicator } from './HealthIndicator';

/**
 * Шапка консоли (концепция §8.2). Слева — быстрый поиск клиента (обычная
 * GET-форма на `/clients?q=`, работает без JS, ничего не меняет). Справа —
 * здоровье платформы, счётчик «ждёт меня» (dual control), оператор с ролью и
 * выход.
 *
 * Счётчик «ждёт меня» — ЗАГЛУШКА 0 (Волна 0): dual-control-очередь (`/money/
 * pending`, Р-452) ещё не построена, настоящий источник появится с модулем
 * денег. Показываем явный 0, а не выдуманное число.
 */
const ROLE_LABEL: Record<OperatorRole, string> = {
  admin: 'Администратор',
  operator: 'Оператор',
  finance_operator: 'Финансы',
};

export function TopBar({ operator }: { operator: OperatorSession }) {
  const waitingForMe = 0; // TODO(деньги/Р-452): реальный счётчик dual-control-очереди.

  return (
    <header className="border-border bg-elevated/95 sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-6 border-b px-6 backdrop-blur-sm">
      <form action="/clients" method="get" role="search" className="relative w-full max-w-md">
        <label htmlFor="global-client-search" className="sr-only">
          Найти клиента
        </label>
        <svg
          viewBox="0 0 16 16"
          aria-hidden
          className="text-muted pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <circle cx="7" cy="7" r="4.75" />
          <path d="M10.5 10.5L14 14" strokeLinecap="round" />
        </svg>
        <input
          id="global-client-search"
          name="q"
          type="search"
          autoComplete="off"
          placeholder="Клиент: имя, email, UID или id"
          className="border-border bg-sunken text-primary placeholder:text-muted focus:border-accent/70 focus:ring-accent/20 h-9 w-full rounded-md border pl-9 pr-3 text-sm focus:outline-none focus:ring-2"
        />
      </form>

      <div className="flex shrink-0 items-center gap-4">
        <HealthIndicator />

        <span
          className="border-border text-secondary flex items-center gap-2 border-l pl-4 text-[13px]"
          title="Операции, ждущие вашего второго подтверждения (dual control)"
        >
          Ждёт меня
          <span className="bg-primary/[0.07] text-primary min-w-6 rounded-md px-1.5 py-0.5 text-center text-xs font-medium tabular-nums">
            {waitingForMe}
          </span>
        </span>

        <span className="border-border flex items-center gap-2.5 border-l pl-4">
          <span
            aria-hidden
            className="bg-primary/[0.08] text-primary flex size-8 items-center justify-center rounded-full text-xs font-semibold"
          >
            {initialsOf(operator.displayName)}
          </span>
          <span className="leading-tight">
            <span className="text-primary block text-[13px] font-medium">
              {operator.displayName}
            </span>
            <span className="text-muted block text-[11px]">
              {ROLE_LABEL[operator.role]} · {operator.login}
            </span>
          </span>
        </span>

        <form action={logoutAction}>
          <Button type="submit" variant="ghost" size="xs">
            Выход
          </Button>
        </form>
      </div>
    </header>
  );
}
