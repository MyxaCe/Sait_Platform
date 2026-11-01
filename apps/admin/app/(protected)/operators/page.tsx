import { notFound, redirect } from 'next/navigation';
import { getOperatorSession } from '@/lib/auth/current';
import { LOGIN_PATH } from '@/lib/auth/constants';
import { listOperators } from '@/lib/operators/queries';
import { CreateOperatorForm } from './_components/CreateOperatorForm';
import { OperatorsTable } from './_components/OperatorsTable';

/**
 * Операторы `/operators` (ADM-04, Р-394, Р-049).
 *
 * Провижининг: список операторов + завод нового + отключение/смена роли.
 * Роль-гейт admin only, fail-closed (Р-394): не-админ получает 404, экран ему
 * НЕ отрисован (а не «серый и кликабельный»). Авторитетный гейт — middleware +
 * layout; эта проверка — defence-in-depth и источник actorId для «нельзя над
 * собой».
 *
 * Серверный компонент: читает из базы напрямую, действия — через server actions.
 */
export const dynamic = 'force-dynamic';

export default async function OperatorsPage() {
  const operator = await getOperatorSession();
  if (!operator) redirect(LOGIN_PATH);
  // Fail-closed: экран операторов виден только админу (Р-394). Не disabled —
  // именно отсутствует (404), чтобы роль-гейт нельзя было обойти POST-ом в UI.
  if (operator.role !== 'admin') notFound();

  const operators = await listOperators();

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Операторы</h1>
        <p className="text-sm text-secondary">
          Провижининг доступа к центру управления. Всего: {operators.length}. Все действия
          журналируются с основанием (Р-049).
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-secondary">
          Завести оператора
        </h2>
        <CreateOperatorForm />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-secondary">
          Список операторов
        </h2>
        <OperatorsTable operators={operators} currentOperatorId={operator.operatorId} />
      </section>
    </div>
  );
}
