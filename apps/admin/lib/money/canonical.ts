import { canonicalize } from '../journal/journal';
import type { MoneyCommandPayload } from './types';

export function canonicalizeCommandPayload(payload: MoneyCommandPayload): string {
  return canonicalize({
    commandId: payload.commandId,
    type: payload.type,
    accountId: payload.accountId,
    amountMinor: payload.amount.amountMinor,
    currency: payload.amount.currency,
    scale: payload.amount.scale,
    initiatorId: payload.initiatorId,
    basisRef: payload.basisRef,
    originalCommandId: payload.originalCommandId,
    initiateApprovalId: payload.initiateApprovalId,
    secondApprovalId: payload.secondApprovalId,
    issuedAt: payload.issuedAt,
    nonce: payload.nonce,
  });
}

export function commandSigningBytes(payload: MoneyCommandPayload): Buffer {
  return Buffer.from(canonicalizeCommandPayload(payload), 'utf8');
}
