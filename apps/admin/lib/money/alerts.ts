import type { MoneyAmount, MoneyCommandType } from './types';

export type MoneyAlertChannel = 'telegram' | 'email';

export type MoneyAlertKind =
  | 'break_glass'
  | 'bootstrap_self_approval'
  | 'replayed_nonce'
  | 'expired_timestamp'
  | 'future_timestamp'
  | 'rejected'
  | 'bad_signature';

export interface MoneyAlert {
  kind: MoneyAlertKind;
  commandId: string;
  type: MoneyCommandType;
  accountId: string;
  amount: MoneyAmount;
  initiatorId: string;
  secondApproverId: string | null;
  basisRef: string;
  result: string;
  breakGlass: boolean;
  incidentRef: string | null;
}

export interface BuildMoneyAlertInput {
  kind: MoneyAlertKind;
  commandId: string;
  type: MoneyCommandType;
  accountId: string;
  amount: MoneyAmount;
  initiatorId: string;
  secondApproverId?: string | null;
  basisRef: string;
  result: string;
  breakGlass?: boolean;
  incidentRef?: string | null;
}

export function buildMoneyAlert(input: BuildMoneyAlertInput): MoneyAlert {
  return {
    kind: input.kind,
    commandId: input.commandId,
    type: input.type,
    accountId: input.accountId,
    amount: input.amount,
    initiatorId: input.initiatorId,
    secondApproverId: input.secondApproverId ?? null,
    basisRef: input.basisRef,
    result: input.result,
    breakGlass: input.breakGlass ?? false,
    incidentRef: input.incidentRef ?? null,
  };
}

export interface MoneyAlertChannelPort {
  readonly channel: MoneyAlertChannel;
  send(alert: MoneyAlert): Promise<void>;
}

export interface AdminAlertPort {
  alertAllAdmins(alert: MoneyAlert): Promise<void>;
}

export const noopAdminAlert: AdminAlertPort = {
  async alertAllAdmins() {
  },
};

export interface DispatchResult {
  channel: MoneyAlertChannel;
  ok: boolean;
  error?: unknown;
}

export async function dispatchMoneyAlert(
  alert: MoneyAlert,
  channels: readonly MoneyAlertChannelPort[],
): Promise<DispatchResult[]> {
  const order: Record<MoneyAlertChannel, number> = { telegram: 0, email: 1 };
  const sorted = [...channels].sort((a, b) => order[a.channel] - order[b.channel]);
  const results: DispatchResult[] = [];
  for (const ch of sorted) {
    try {
      await ch.send(alert);
      results.push({ channel: ch.channel, ok: true });
    } catch (error) {
      results.push({ channel: ch.channel, ok: false, error });
    }
  }
  return results;
}
