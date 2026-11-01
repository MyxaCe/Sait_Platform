import { Badge } from '@broker/ui';
import type { OperatorListItem } from '@/lib/operators/queries';
import { OperatorRowActions } from './OperatorRowActions';

/**
 * Плотная таблица операторов (ADM-04, паттерн «таблица-очередь» §5.3).
 * Локальная таблица в admin (не трогаем `packages/ui`). Серверный компонент —
 * строки приходят готовыми; действия в последней колонке — клиентские.
 */

function formatMoment(iso: string): string {
  // Короткая форма «дата время», tabular-friendly, без локалезависимых слов.
  return iso.replace('T', ' ').slice(0, 16);
}

export function OperatorsTable({
  operators,
  currentOperatorId,
}: {
  operators: OperatorListItem[];
  currentOperatorId: string;
}) {
  if (operators.length === 0) {
    return (
      <p className="rounded border border-border bg-elevated px-4 py-6 text-center text-secondary">
        Операторов пока нет.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full border-collapse text-sm tabular-nums">
        <thead>
          <tr className="border-b border-border bg-elevated text-left text-xs uppercase tracking-wide text-secondary">
            <th className="px-3 py-2 font-medium">Логин</th>
            <th className="px-3 py-2 font-medium">Имя</th>
            <th className="px-3 py-2 font-medium">Роль</th>
            <th className="px-3 py-2 font-medium">Создан</th>
            <th className="px-3 py-2 font-medium">Статус</th>
            <th className="px-3 py-2 font-medium">2FA</th>
            <th className="px-3 py-2 font-medium">Действия</th>
          </tr>
        </thead>
        <tbody>
          {operators.map((op) => {
            const isSelf = op.id === currentOperatorId;
            const active = op.disabledAt === null;
            return (
              <tr
                key={op.id}
                className="border-b border-border last:border-0 bg-card align-top hover:bg-elevated/60"
              >
                <td className="px-3 py-2 font-medium text-primary">{op.login}</td>
                <td className="px-3 py-2 text-primary">{op.displayName}</td>
                <td className="px-3 py-2">
                  <Badge variant={op.role === 'admin' ? 'accent' : 'neutral'} className="px-2 py-0.5 text-xs">
                    {op.role}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-secondary">{formatMoment(op.createdAt)}</td>
                <td className="px-3 py-2">
                  {active ? (
                    <Badge variant="positive" className="px-2 py-0.5 text-xs">
                      активен
                    </Badge>
                  ) : (
                    <Badge variant="negative" className="px-2 py-0.5 text-xs">
                      отключён
                    </Badge>
                  )}
                </td>
                <td className="px-3 py-2 text-secondary">
                  {op.totpEnrolled ? 'включена' : '—'}
                </td>
                <td className="px-3 py-2">
                  {isSelf ? (
                    <span className="text-xs text-secondary">— это вы —</span>
                  ) : active ? (
                    <OperatorRowActions operatorId={op.id} login={op.login} role={op.role} />
                  ) : (
                    <span className="text-xs text-secondary">нет действий</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
