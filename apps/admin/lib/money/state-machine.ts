import { requiresSecondApproval } from './config';
import type { MoneyCommandState, MoneyInitiatorRole } from './types';

export function initialStateFor(
  role: MoneyInitiatorRole,
  amountMinor: string,
  bootstrapMode: boolean,
  breakGlass = false,
): MoneyCommandState {
  if (breakGlass) return 'draft';
  if (role === 'admin' && bootstrapMode) return 'draft';
  return requiresSecondApproval(amountMinor) ? 'awaiting_second_approval' : 'draft';
}

export type MoneyCommandEvent =
  | { kind: 'sign'; role: MoneyInitiatorRole; amountMinor: string; bootstrapMode: boolean; breakGlass?: boolean }
  | { kind: 'secondApprove'; initiatorId: string; approverId: string }
  | { kind: 'dispatch' }
  | { kind: 'execute' }
  | { kind: 'reject' };

export type TransitionError =
  | 'illegalTransition'
  | 'secondApprovalRequired'
  | 'selfApprovalForbidden';

export type TransitionResult =
  | { ok: true; state: MoneyCommandState }
  | { ok: false; error: TransitionError };

export function transition(
  state: MoneyCommandState,
  event: MoneyCommandEvent,
): TransitionResult {
  switch (state) {
    case 'draft':
      if (event.kind === 'sign') {
        if (event.breakGlass) return ok('signed');
        if (event.role === 'admin' && event.bootstrapMode) return ok('signed');
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
      return illegal();

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
