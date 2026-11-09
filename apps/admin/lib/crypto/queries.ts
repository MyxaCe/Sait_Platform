import { moneyPool } from './runtime';

/** Чтения раздела «Деньги» (депозиты, неопознанные, выводы). Только чтение. */

export interface DepositRowView {
  id: string;
  userId: string | null;
  clientName: string | null;
  clientEmail: string | null;
  txHash: string;
  status: string;
  fromAddress: string | null;
  amountRaw: string | null;
  amountMinor: number | null;
  dustRaw: string | null;
  rejectReason: string | null;
  checkNote: string | null;
  claimedAt: string;
  creditedAt: string | null;
  blockTime: string | null;
}

export interface WithdrawalRowView {
  id: string;
  userId: string;
  clientName: string;
  clientEmail: string;
  toAddress: string;
  amountMinor: number;
  status: string;
  debitState: string;
  rejectReason: string | null;
  reviewReason: string | null;
  checkNote: string | null;
  payoutTxHash: string | null;
  refunded: boolean;
  requestedAt: string;
}

const iso = (v: unknown) => (v ? new Date(v as string | Date).toISOString() : null);

function mapDeposit(r: Record<string, unknown>): DepositRowView {
  return {
    id: r.id as string,
    userId: (r.user_id as string | null) ?? null,
    clientName: (r.full_name as string | null) ?? null,
    clientEmail: (r.email as string | null) ?? null,
    txHash: r.tx_hash as string,
    status: r.status as string,
    fromAddress: (r.from_address as string | null) ?? null,
    amountRaw: r.amount_raw === null || r.amount_raw === undefined ? null : String(r.amount_raw),
    amountMinor: r.amount_minor === null || r.amount_minor === undefined ? null : Number(r.amount_minor),
    dustRaw: r.dust_raw === null || r.dust_raw === undefined ? null : String(r.dust_raw),
    rejectReason: (r.reject_reason as string | null) ?? null,
    checkNote: (r.check_note as string | null) ?? null,
    claimedAt: iso(r.claimed_at)!,
    creditedAt: iso(r.credited_at),
    blockTime: iso(r.block_time),
  };
}

const DEPOSIT_SELECT = `SELECT d.*, u.full_name, u.email
                          FROM crypto_deposits d LEFT JOIN users u ON u.id = d.user_id`;

export async function listDeposits(): Promise<DepositRowView[]> {
  const r = await moneyPool().query(
    `${DEPOSIT_SELECT} WHERE d.status <> 'unidentified' ORDER BY d.claimed_at DESC LIMIT 300`,
  );
  return r.rows.map(mapDeposit);
}

export async function listUnidentified(): Promise<DepositRowView[]> {
  const r = await moneyPool().query(
    `${DEPOSIT_SELECT} WHERE d.status = 'unidentified' ORDER BY d.block_time DESC NULLS LAST LIMIT 300`,
  );
  return r.rows.map(mapDeposit);
}

function mapWithdrawal(r: Record<string, unknown>): WithdrawalRowView {
  return {
    id: r.id as string,
    userId: r.user_id as string,
    clientName: r.full_name as string,
    clientEmail: r.email as string,
    toAddress: r.to_address as string,
    amountMinor: Number(r.amount_minor),
    status: r.status as string,
    debitState: r.debit_state as string,
    rejectReason: (r.reject_reason as string | null) ?? null,
    reviewReason: (r.review_reason as string | null) ?? null,
    checkNote: (r.check_note as string | null) ?? null,
    payoutTxHash: (r.payout_tx_hash as string | null) ?? null,
    refunded: r.refunded_at !== null && r.refunded_at !== undefined,
    requestedAt: iso(r.requested_at)!,
  };
}

/** Выводы: сперва требующие действия (requested/approved/needs_review), потом прочие. */
export async function listWithdrawals(): Promise<WithdrawalRowView[]> {
  const r = await moneyPool().query(
    `SELECT w.*, u.full_name, u.email
       FROM crypto_withdrawals w JOIN users u ON u.id = w.user_id
      ORDER BY CASE w.status WHEN 'needs_review' THEN 0 WHEN 'requested' THEN 1
                             WHEN 'approved' THEN 2 WHEN 'sent' THEN 3 ELSE 4 END,
               w.requested_at DESC
      LIMIT 300`,
  );
  return r.rows.map(mapWithdrawal);
}

export async function listClientDeposits(userId: string): Promise<DepositRowView[]> {
  const r = await moneyPool().query(
    `${DEPOSIT_SELECT} WHERE d.user_id = $1 ORDER BY d.claimed_at DESC LIMIT 50`,
    [userId],
  );
  return r.rows.map(mapDeposit);
}

export async function listClientWithdrawals(userId: string): Promise<WithdrawalRowView[]> {
  const r = await moneyPool().query(
    `SELECT w.*, u.full_name, u.email
       FROM crypto_withdrawals w JOIN users u ON u.id = w.user_id
      WHERE w.user_id = $1 ORDER BY w.requested_at DESC LIMIT 50`,
    [userId],
  );
  return r.rows.map(mapWithdrawal);
}

/** Поиск клиента для привязки неопознанного: точный email, UID или UUID. */
export async function findClientForBinding(query: string): Promise<string | null> {
  const q = query.trim();
  if (!q) return null;
  const r = await moneyPool().query(
    `SELECT id FROM users
      WHERE lower(email) = lower($1) OR uid::text = $1 OR id::text = $1
      LIMIT 2`,
    [q],
  );
  return r.rows.length === 1 ? (r.rows[0]!.id as string) : null;
}
