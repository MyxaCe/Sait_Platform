import { Button } from '@broker/ui';
import { logoutAction } from '@/lib/auth/logout';
import type { OperatorSession } from '@/lib/auth/session';
import { HealthIndicator } from './HealthIndicator';

/**
 * Шапка консоли (§2.1). Сохраняет имя+роль оператора и добавляет: индикатор
 * здоровья платформы, счётчик «ждёт меня» на 2-е подтверждение (dual control)
 * и выход.
 *
 * Счётчик «ждёт меня» — ЗАГЛУШКА 0 (Волна 0): dual-control-очередь (`/money/
 * pending`, Р-452) ещё не построена, настоящий источник появится с модулем
 * денег. Показываем явный 0, а не выдуманное число.
 */
export function TopBar({ operator }: { operator: OperatorSession }) {
  const waitingForMe = 0; // TODO(деньги/Р-452): реальный счётчик dual-control-очереди.

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-elevated px-6">
      <span className="font-semibold">Центр управления</span>

      <div className="flex items-center gap-5">
        <HealthIndicator />

        <span
          className="flex items-center gap-2 text-sm text-secondary"
          title="Операции, ждущие вашего второго подтверждения (dual control)"
        >
          Ждёт меня
          <span className="min-w-6 rounded-full border border-border bg-card px-2 py-0.5 text-center text-xs tabular-nums text-primary">
            {waitingForMe}
          </span>
        </span>

        <span className="text-sm text-secondary">
          {operator.displayName}
          <span className="ml-2 rounded bg-accent/20 px-2 py-0.5 text-xs uppercase text-accent">
            {operator.role}
          </span>
        </span>

        <form action={logoutAction}>
          <Button type="submit" variant="ghost" size="sm">
            Выход
          </Button>
        </form>
      </div>
    </header>
  );
}
