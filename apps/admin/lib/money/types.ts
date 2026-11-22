export type MoneyCommandType =
  | 'credit'
  | 'debit'
  | 'reversal'
  | 'zeroing'
  | 'adjustment';

export const MONEY_COMMAND_TYPES: readonly MoneyCommandType[] = [
  'credit',
  'debit',
  'reversal',
  'zeroing',
  'adjustment',
];

export type MoneyInitiatorRole = 'admin' | 'finance_operator';

export const MONEY_INITIATOR_ROLES: readonly MoneyInitiatorRole[] = ['admin', 'finance_operator'];

export function isMoneyInitiatorRole(value: unknown): value is MoneyInitiatorRole {
  return value === 'admin' || value === 'finance_operator';
}

export type MoneyCommandState =
  | 'draft'
  | 'awaiting_second_approval'
  | 'signed'
  | 'dispatched'
  | 'executed'
  | 'rejected';

export const MONEY_COMMAND_STATES: readonly MoneyCommandState[] = [
  'draft',
  'awaiting_second_approval',
  'signed',
  'dispatched',
  'executed',
  'rejected',
];

export interface MoneyAmount {
  amountMinor: string;
  currency: string;
  scale: number;
}

export interface MoneyCommandPayload {
  commandId: string;
  type: MoneyCommandType;
  accountId: string;
  amount: MoneyAmount;
  initiatorId: string;
  basisRef: string;
  originalCommandId: string | null;
  initiateApprovalId: string;
  secondApprovalId: string | null;
  issuedAt: string;
  nonce: string;
}

export interface SignedMoneyCommand {
  payload: MoneyCommandPayload;
  signature: string;
  keyVersion: string;
}

export type ApprovalKind = 'initiate' | 'second_approval';

export interface MoneyCommandApproval {
  commandId: string;
  approverId: string;
  kind: ApprovalKind;
  approvedAt: string;
}
