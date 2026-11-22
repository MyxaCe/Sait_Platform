import { Button, initialsOf } from '@broker/ui';
import { logoutAction } from '@/lib/auth/logout';
import type { OperatorRole, OperatorSession } from '@/lib/auth/session';
import { HealthIndicator } from './HealthIndicator';

const SHOW_WAITING_FOR_ME = false;

const ROLE_LABEL: Record<OperatorRole, string> = {
  admin: 'Администратор',
  operator: 'Оператор',
  finance_operator: 'Финансы',
  support_operator: 'Поддержка',
};

export function TopBar({ operator }: { operator: OperatorSession }) {
  const waitingForMe = 0;

  return (
    <header className="border-border bg-elevated/95 sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-4 border-b px-6 backdrop-blur-sm xl:gap-6">
      <form
        action="/clients"
        method="get"
        role="search"
        className="relative min-w-[14rem] max-w-md flex-1"
      >
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
          placeholder="Найти клиента: имя, email, id"
          title="Поиск клиента по имени, email, UID или id"
          className="border-border bg-sunken text-primary placeholder:text-muted focus:border-accent/70 focus:ring-accent/20 h-9 w-full rounded-md border pl-9 pr-3 text-sm focus:outline-none focus:ring-2"
        />
      </form>

      <div className="flex shrink-0 items-center gap-4">
        <HealthIndicator />

        {SHOW_WAITING_FOR_ME ? (
          <span
            className="border-border text-secondary flex items-center gap-2 border-l pl-4 text-[13px]"
            title="Операции, ждущие вашего второго подтверждения (dual control)"
          >
            Ждёт меня
            <span className="bg-primary/[0.07] text-primary min-w-6 rounded-md px-1.5 py-0.5 text-center text-xs font-medium tabular-nums">
              {waitingForMe}
            </span>
          </span>
        ) : null}

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
            <span className="text-muted hidden text-[11px] xl:block">
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
