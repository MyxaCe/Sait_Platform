import { requiresSecondApproval } from './config';
import type { MoneyCommandState, MoneyInitiatorRole } from './types';

/**
 * Стейт-машина dual control денежных команд (Р-452) — ЧИСТАЯ логика переходов,
 * без базы и крипто. Персистентная оркестрация (`commands.ts`) надстраивается
 * над ней и журналирует каждый переход; здесь — закон переходов, проверяемый
 * изолированно.
 *
 * fail-closed: разрешён только явно описанный переход при выполненных гардах.
 * Всё остальное — отказ (а не «наверное можно»).
 *
 * СОЗДАНИЕ команды не является переходом: команда рождается в `draft` (или сразу
 * в `awaiting_second_approval`, если сумма выше порога — это решает оркестрация
 * через `initialStateFor`). Переходы ниже двигают уже существующую команду.
 */

/**
 * Начальное состояние новой команды (Р-455 R-2 + поправка). РОЛЬ инициатора
 * решает путь:
 *  - `admin` → всегда `draft` (ПОЛНОСТЬЮ освобождён от второго аппрува, любая
 *    сумма; команда подпишется сразу);
 *  - `finance_operator` → `awaiting_second_approval`, если сумма выше порога
 *    (порог=0 по Р-455 R-2 → всегда), иначе `draft`.
 * break-glass (admin-only, Р-455 R-5) не меняет состояние — admin и так в
 * `draft`; флаг несёт инцидент/алерт/ревью, а не дополнительный обход.
 */
export function initialStateFor(
  role: MoneyInitiatorRole,
  amountMinor: string,
  breakGlass = false,
): MoneyCommandState {
  if (role === 'admin') return 'draft'; // Р-455 R-2-поправка: admin без второго аппрува
  void breakGlass; // break-glass — admin-only; для finance_operator не достижим (гард в оркестрации)
  return requiresSecondApproval(amountMinor) ? 'awaiting_second_approval' : 'draft';
}

/** События, двигающие уже созданную команду. */
export type MoneyCommandEvent =
  | { kind: 'sign'; role: MoneyInitiatorRole; amountMinor: string; breakGlass?: boolean }
  | { kind: 'secondApprove'; initiatorId: string; approverId: string }
  | { kind: 'dispatch' }
  | { kind: 'execute' }
  | { kind: 'reject' };

export type TransitionError =
  /** Переход не определён для текущего состояния. */
  | 'illegalTransition'
  /** Сумма выше порога: подписать из draft нельзя, нужен второй аппрув. */
  | 'secondApprovalRequired'
  /** Self-approval: подтверждающий совпал с инициатором (или та же учётка). */
  | 'selfApprovalForbidden';

export type TransitionResult =
  | { ok: true; state: MoneyCommandState }
  | { ok: false; error: TransitionError };

/**
 * Единственная функция перехода. Возвращает следующее состояние или причину
 * отказа. Гарды:
 *  - порог (Р-452): `sign` из `draft` разрешён, только если второй аппрув НЕ
 *    нужен ИЛИ это break-glass; иначе `secondApprovalRequired` (защита от того,
 *    что крупную команду подпишут в обход второго аппрувера).
 *  - self-approval (Р-452): `secondApprove` запрещён, если `approverId ===
 *    initiatorId` — инициатор не подтверждает сам себя (сравнение учёток).
 */
export function transition(
  state: MoneyCommandState,
  event: MoneyCommandEvent,
): TransitionResult {
  switch (state) {
    case 'draft':
      if (event.kind === 'sign') {
        // Р-455 R-2-поправка: admin подписывает из draft на любую сумму без
        // второго аппрува. finance_operator — только если второй аппрув не
        // требуется (при пороге 0 он в draft не окажется; гард вглубь).
        if (event.role === 'admin') return ok('signed');
        if (!event.breakGlass && requiresSecondApproval(event.amountMinor)) {
          return { ok: false, error: 'secondApprovalRequired' };
        }
        return ok('signed');
      }
      return illegal();

    case 'awaiting_second_approval':
      if (event.kind === 'secondApprove') {
        if (event.approverId === event.initiatorId) {
          return { ok: false, error: 'selfApprovalForbidden' };
        }
        return ok('signed');
      }
      return illegal();

    case 'signed':
      if (event.kind === 'dispatch') return ok('dispatched');
      return illegal();

    case 'dispatched':
      if (event.kind === 'execute') return ok('executed');
      if (event.kind === 'reject') return ok('rejected');
      return illegal();

    case 'executed':
    case 'rejected':
      return illegal(); // терминальны

    default:
      return illegal();
  }
}

function ok(state: MoneyCommandState): TransitionResult {
  return { ok: true, state };
}

function illegal(): TransitionResult {
  return { ok: false, error: 'illegalTransition' };
}
