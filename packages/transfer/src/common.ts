import { appendJournalSeqWithinTx, type JournalEntryInput, type Queryable } from '@broker/money';

/** Системный автор журнала канала (миграция 1795710000000_platform_transfers). */
export const TRANSFER_SYSTEM_OPERATOR = '00000000-0000-4000-8000-00000000c0b5';

/** Коды журнала перевода — один словарь (подписи — apps/admin/lib/journal/labels.ts). */
export const TRANSFER_ACTIONS = {
  // источник
  sent: 'client.transfer.sent',
  delivered: 'client.transfer.delivered',
  refused: 'client.transfer.refused',
  targetInvited: 'client.transfer.target_invited',
  targetRegistered: 'client.transfer.target_registered',
  targetKycPassed: 'client.transfer.target_kyc_passed',
  targetExpired: 'client.transfer.target_expired',
  sourceClosed: 'client.transfer.source_closed',
  revoked: 'client.transfer.revoked',
  revokeApplied: 'client.transfer.revoke_applied',
  restored: 'client.transfer.source_restored',
  deliveryRetried: 'client.transfer.delivery_retried',
  seen: 'client.transfer.reviewed',
  // цель
  received: 'client.transfer.received',
  inviteQueued: 'client.transfer.invite_queued',
  invited: 'client.transfer.invited',
  registered: 'client.transfer.registered',
  kycPassed: 'client.transfer.kyc_passed',
  expired: 'client.transfer.expired',
  inviteRevoked: 'client.transfer.invite_revoked',
  revokedByGroup: 'client.transfer.revoked_by_group',
  refundTaskDone: 'client.transfer.refund_task_done',
  // канал
  messageRefused: 'platform.transfer_channel.refused',
} as const;

export function iso(v: unknown): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
}

export async function journal(tx: Queryable, entry: JournalEntryInput): Promise<number> {
  return appendJournalSeqWithinTx(entry, tx);
}

/**
 * Флаги денег клиента (заморозка/запрет вывода) ВНУТРИ транзакции — та же
 * таблица и те же коды журнала, что у формы «Деньги» карточки
 * (`apps/admin/lib/crypto/flags.ts`). Терминал (торговля) вызывается отдельно,
 * вне транзакции, и повторяется воркером — у терминала свой failure domain.
 */
export async function setMoneyFlagsWithinTx(
  tx: Queryable,
  input: {
    userId: string;
    operatorId: string;
    basis: string;
    transferId: string;
    frozen?: boolean;
    withdrawBanned?: boolean;
  },
): Promise<{ changed: ('frozen' | 'withdrawBanned')[]; before: { frozen: boolean; withdrawBanned: boolean } }> {
  await tx.query(`INSERT INTO client_money_flags (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [input.userId]);
  const cur = await tx.query(`SELECT frozen, withdraw_banned FROM client_money_flags WHERE user_id = $1 FOR UPDATE`, [
    input.userId,
  ]);
  const before = { frozen: Boolean(cur.rows[0]?.frozen), withdrawBanned: Boolean(cur.rows[0]?.withdraw_banned) };
  const next = {
    frozen: input.frozen ?? before.frozen,
    withdrawBanned: input.withdrawBanned ?? before.withdrawBanned,
  };
  const changed = (['frozen', 'withdrawBanned'] as const).filter((k) => before[k] !== next[k]);
  if (!changed.length) return { changed: [], before };
  await tx.query(
    `UPDATE client_money_flags SET frozen = $2, withdraw_banned = $3, updated_at = now(), updated_by = $4 WHERE user_id = $1`,
    [input.userId, next.frozen, next.withdrawBanned, input.operatorId],
  );
  let seq = 0;
  for (const key of changed) {
    const action =
      key === 'frozen'
        ? next.frozen
          ? 'client.money.frozen'
          : 'client.money.unfrozen'
        : next.withdrawBanned
          ? 'client.money.withdraw_banned'
          : 'client.money.withdraw_unbanned';
    seq = await journal(tx, {
      operatorId: input.operatorId,
      action,
      subjectKind: 'client',
      subjectId: input.userId,
      payload: { basis: input.basis, field: key, before: before[key], after: next[key], transferId: input.transferId },
    });
  }
  await tx.query(`UPDATE client_money_flags SET last_journal_seq = $2 WHERE user_id = $1`, [input.userId, seq]);
  return { changed: [...changed], before };
}

export interface RealAccountState {
  balanceMinor: number | null;
  equityMinor: number | null;
  openPositions: number | null;
}

/**
 * Порт терминала: заморозка торговли реального счёта и баланс. Реализация —
 * в приложении (админка: `@broker/money` клиент терминала). Пакет не знает
 * адресов и токенов.
 */
export interface TransferTerminalPort {
  setTradingFrozen(userId: string, frozen: boolean, reason: string): Promise<'ok' | 'unavailable' | 'refused'>;
  /**
   * Состояние РЕАЛЬНОГО счёта (демо не учитывается): `null` — счёт в терминале
   * не открыт; `'unavailable'` — терминал не ответил. Поля `null` в ответе
   * терминала вызывающий трактует как «не удалось проверить» (fail-closed).
   */
  realAccountState(userId: string): Promise<RealAccountState | null | 'unavailable'>;
}
