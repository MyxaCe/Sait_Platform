import { requiresSecondApproval } from './config';
import type { MoneyCommandState } from './types';

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

/** Начальное состояние новой команды по сумме/break-glass (Р-452). */
export function initialStateFor(amountMinor: string, breakGlass = false): MoneyCommandState {
  if (breakGlass) return 'draft'; // break-glass обходит второй аппрув → сразу готов к подписи
  return requiresSecondApproval(amountMinor) ? 'awaiting_second_approval' : 'draft';
}

/** События, двигающие уже созданную команду. */
export type MoneyCommandEvent =
  | { kind: 'sign'; amountMinor: string; breakGlass?: boolean }
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
