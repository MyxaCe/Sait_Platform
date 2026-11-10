'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getOperatorSession } from '../auth/current';
import { canAccessSection } from '@/components/shell/sections';
import { LOGIN_PATH } from '../auth/constants';
import { clearAmlEscalation, recordAmlScreening } from './screening';
import { normalizeSanctionsLists, type AmlOutcome } from './lists';

/**
 * Серверные экшены ручного AML-скрининга (ADM-14, Р-454 I-5, Р-049).
 *
 * **Почему server actions, а не `/api`.** Та же причина, что у KYC и «Клиентов»
 * (`lib/kyc/actions.ts`): `/api` закрыт по умолчанию (Р-451 п.3), server action
 * — POST в уже защищённый `(protected)`-роут, новой публичной поверхности не
 * заводит.
 *
 * **Автор — из сессии, НЕ из формы (Р-451).** `operatorId` берём из
 * `getOperatorSession()`. Нет сессии → на вход (defense in depth поверх
 * middleware).
 *
 * **Роль-гейт: сверяют operator И admin (Р-454 III-1: AML-скрининг — как
 * KYC-решение, доступен обеим ролям).** fail-closed: без валидной сессии дело
 * до транзакции не доходит. Исход «найдено» автоматически блокирует клиента
 * ТОЙ ЖЕ транзакцией (Р-456 D) — это делает ядро, не оператор.
 *
 * **Снятие AML-эскалации — ТОЛЬКО admin (fail-closed).** Оно разблокирует
 * клиента, а блокировка/разблокировка клиента по Р-454 III-1 — admin-действие;
 * обратить автоматический защитный блок тем более admin-только. Оператор может
 * ВЫЗВАТЬ эскалацию (через скрининг), но не СНЯТЬ её.
 */

export interface ScreeningState {
  error?: string;
  ok?: boolean;
}

function asOutcome(value: unknown): AmlOutcome | null {
  return value === 'clear' || value === 'escalated' ? value : null;
}

/**
 * Зафиксировать результат ручного скрининга. Один экшен, исход — из поля формы
 * (`outcome`), а не из того, какую кнопку нажали: списки и основание общие, а
 * исход выбирает оператор радио-кнопкой.
 */
export async function recordScreeningAction(
  _prev: ScreeningState,
  formData: FormData,
): Promise<ScreeningState> {
  const operator = await getOperatorSession();
  if (!operator) {
    // Личность автора обязана быть из валидной сессии — иначе на вход.
    redirect(LOGIN_PATH);
  }
  // AML-скрининг — только ролям раздела AML (матрица sections.ts).
  if (!canAccessSection(operator.role, 'aml')) return { error: 'forbidden' };

  const userId = String(formData.get('userId') ?? '').trim();
  if (!userId) return { error: 'invalidClient' };

  const outcome = asOutcome(formData.get('outcome'));
  if (!outcome) return { error: 'invalidOutcome' };

  const lists = normalizeSanctionsLists(formData.getAll('lists'));
  const reason = String(formData.get('reason') ?? '');

  const result = await recordAmlScreening({
    operatorId: operator.operatorId,
    userId,
    outcome,
    listsChecked: lists,
    reason,
  });

  if (!result.ok) {
    // Причины машиночитаемы; форма покажет человеку их смысл.
    return { error: result.reason };
  }

  // Карточка серверная (force-dynamic), но ревалидируем явно — статус, история и
  // рабочий список изменились, покажем их сразу после действия. При эскалации
  // изменилось и состояние блокировки — обновим и карточку клиента.
  revalidatePath(`/aml/${userId}`);
  revalidatePath('/aml');
  revalidatePath(`/clients/${userId}`);
  return { ok: true };
}

/**
 * Снять AML-эскалацию (ложное срабатывание) после ручной проверки. ADMIN ONLY,
 * fail-closed: оператор без роли admin получает `forbidden`, до транзакции дело
 * не доходит. Основание обязательно (кто/когда/почему признано ложным).
 */
export async function clearEscalationAction(
  _prev: ScreeningState,
  formData: FormData,
): Promise<ScreeningState> {
  const operator = await getOperatorSession();
  if (!operator) {
    redirect(LOGIN_PATH);
  }
  if (operator.role !== 'admin' || !canAccessSection(operator.role, 'aml')) {
    // Снятие защитного блока — admin-действие (Р-454 III-1), fail-closed.
    return { error: 'forbidden' };
  }

  const userId = String(formData.get('userId') ?? '').trim();
  if (!userId) return { error: 'invalidClient' };
  const reason = String(formData.get('reason') ?? '');

  const result = await clearAmlEscalation({
    operatorId: operator.operatorId,
    userId,
    reason,
  });

  if (!result.ok) {
    return { error: result.reason };
  }

  revalidatePath(`/aml/${userId}`);
  revalidatePath('/aml');
  revalidatePath(`/clients/${userId}`);
  return { ok: true };
}
