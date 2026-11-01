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
 * Начальное состояние новой команды (Р-455 R-2 + поправка, Р-456 C). РОЛЬ
 * инициатора И bootstrap-режим решают путь:
 *  - `admin` ПРИ `bootstrapMode=true` → `draft` на любую сумму (ВРЕМЕННОЕ
 *    исключение Р-456: admin инициирует и подтвердит сам; каждый self-approval
 *    — с алертом и записью, см. оркестрацию);
 *  - `admin` ПРИ `bootstrapMode=false` → как finance_operator: по порогу (admin
 *    больше НЕ освобождён, self-approval блокируется);
 *  - `finance_operator` → `awaiting_second_approval`, если сумма выше порога
 *    (порог=0 по Р-455 R-2 → всегда), иначе `draft`.
 * break-glass (admin-only, Р-455 R-5) — отдельный аварийный обход, не зависит
 * от bootstrap: admin с break-glass идёт `draft` (несёт инцидент/алерт/ревью).
 */
export function initialStateFor(
  role: MoneyInitiatorRole,
  amountMinor: string,
  bootstrapMode: boolean,
  breakGlass = false,
): MoneyCommandState {
  // break-glass (admin-only) — всегда draft: аварийный обход со своим следом.
  if (breakGlass) return 'draft';
  // Р-456 C: admin освобождён ТОЛЬКО во временном bootstrap-режиме.
  if (role === 'admin' && bootstrapMode) return 'draft';
  // Иначе (finance_operator, либо admin без bootstrap) — по порогу dual control.
  return requiresSecondApproval(amountMinor) ? 'awaiting_second_approval' : 'draft';
}

/** События, двигающие уже созданную команду. */
export type MoneyCommandEvent =
  | { kind: 'sign'; role: MoneyInitiatorRole; amountMinor: string; bootstrapMode: boolean; breakGlass?: boolean }
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
        // break-glass (admin-only) — аварийный обход, подписывается из draft.
        if (event.breakGlass) return ok('signed');
        // Р-456 C: admin подписывает собственную команду из draft (self-approval)
        // ТОЛЬКО во временном bootstrap-режиме. Без bootstrap admin больше не
        // освобождён — идёт общий гард порога (и не окажется в draft выше порога).
        if (event.role === 'admin' && event.bootstrapMode) return ok('signed');
        // finance_operator (и admin без bootstrap) — только если второй аппрув
        // не требуется (при пороге 0 в draft не окажется; гард вглубь).
        if (requiresSecondApproval(event.amountMinor)) {
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
