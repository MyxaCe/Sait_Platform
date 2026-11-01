'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getOperatorSession } from '../auth/current';
import { LOGIN_PATH } from '../auth/constants';
import { recordAmlScreening } from './screening';
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
 * до транзакции не доходит.
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
  // рабочий список изменились, покажем их сразу после действия.
  revalidatePath(`/aml/${userId}`);
  revalidatePath('/aml');
  return { ok: true };
}
