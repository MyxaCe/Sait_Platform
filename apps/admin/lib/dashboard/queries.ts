import { getPool, type Queryable } from '../db';

/**
 * Сводка дашборда (ТОЛЬКО ЧТЕНИЕ). Агрегаты по тем же таблицам, что читают
 * разделы: клиенты/KYC/AML/блокировки и денежные очереди. Ничего не пишет,
 * журнал не трогает. Денежная часть отдельной функцией — её зовут только для
 * ролей с доступом к деньгам (fail-closed: оператор её не получает вовсе).
 */

export interface ClientsSummary {
  total: number;
  verified: number;
  blocked: number;
  newLast7d: number;
  amlEscalated: number;
  amlUnscreened: number;
}

export async function getClientsSummary(db: Queryable = getPool()): Promise<ClientsSummary> {
  const r = await db.query(
    `SELECT
       (SELECT count(*) FROM users)::int AS total,
       (SELECT count(*) FROM client_verification WHERE state = 'verified')::int AS verified,
       (SELECT count(*) FROM client_blocks WHERE blocked)::int AS blocked,
       (SELECT count(*) FROM users WHERE created_at > now() - interval '7 days')::int AS new_7d,
       (SELECT count(*) FROM client_aml_screening WHERE status = 'escalated')::int AS aml_escalated,
       (SELECT count(*) FROM users u
          LEFT JOIN client_aml_screening a ON a.user_id = u.id
         WHERE a.user_id IS NULL OR a.status = 'unscreened')::int AS aml_unscreened`,
  );
  const row = r.rows[0] as Record<string, number>;
  return {
    total: row.total ?? 0,
    verified: row.verified ?? 0,
    blocked: row.blocked ?? 0,
    newLast7d: row.new_7d ?? 0,
    amlEscalated: row.aml_escalated ?? 0,
    amlUnscreened: row.aml_unscreened ?? 0,
  };
}

export interface MoneySummary {
  /** Выводы, ждущие решения оператора (подана + на проверке). */
  withdrawalsPending: number;
  withdrawalsPendingMinor: number;
  needsReview: number;
  unidentified: number;
  unidentifiedMinor: number;
  depositsCredited7dMinor: number;
  withdrawalsSettled7dMinor: number;
}

export async function getMoneySummary(db: Queryable = getPool()): Promise<MoneySummary> {
  const r = await db.query(
    `SELECT
       (SELECT count(*) FROM crypto_withdrawals WHERE status IN ('requested','needs_review'))::int AS wp,
       (SELECT coalesce(sum(amount_minor),0) FROM crypto_withdrawals WHERE status IN ('requested','needs_review'))::bigint AS wp_minor,
       (SELECT count(*) FROM crypto_withdrawals WHERE status = 'needs_review')::int AS review,
       (SELECT count(*) FROM crypto_deposits WHERE status = 'unidentified')::int AS unid,
       (SELECT coalesce(sum(amount_minor),0) FROM crypto_deposits WHERE status = 'unidentified')::bigint AS unid_minor,
       (SELECT coalesce(sum(amount_minor),0) FROM crypto_deposits
         WHERE status = 'credited' AND credited_at > now() - interval '7 days')::bigint AS dep7,
       (SELECT coalesce(sum(amount_minor),0) FROM crypto_withdrawals
         WHERE status = 'settled' AND settled_at > now() - interval '7 days')::bigint AS wd7`,
  );
  const row = r.rows[0] as Record<string, number | string>;
  const n = (v: number | string | undefined) => Number(v ?? 0);
  return {
    withdrawalsPending: n(row.wp),
    withdrawalsPendingMinor: n(row.wp_minor),
    needsReview: n(row.review),
    unidentified: n(row.unid),
    unidentifiedMinor: n(row.unid_minor),
    depositsCredited7dMinor: n(row.dep7),
    withdrawalsSettled7dMinor: n(row.wd7),
  };
}

export interface PendingWithdrawal {
  id: string;
  userId: string;
  fullName: string;
  amountMinor: number;
  status: 'requested' | 'needs_review';
  requestedAt: string;
}

export async function listPendingWithdrawals(
  limit = 5,
  db: Queryable = getPool(),
): Promise<PendingWithdrawal[]> {
  const r = await db.query(
    `SELECT w.id, w.user_id, u.full_name, w.amount_minor, w.status, w.requested_at
       FROM crypto_withdrawals w JOIN users u ON u.id = w.user_id
      WHERE w.status IN ('requested','needs_review')
      ORDER BY w.requested_at ASC
      LIMIT $1`,
    [limit],
  );
  return r.rows.map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    fullName: String(row.full_name),
    amountMinor: Number(row.amount_minor),
    status: row.status as PendingWithdrawal['status'],
    requestedAt: new Date(row.requested_at as string).toISOString(),
  }));
}

export interface RecentAction {
  seq: number;
  occurredAt: string;
  action: string;
  operatorName: string | null;
  subjectKind: string;
  subjectId: string;
  /** Имя клиента, если субъект — клиент. */
  subjectName: string | null;
  basis: string | null;
}

export async function listRecentActions(
  limit = 8,
  db: Queryable = getPool(),
): Promise<RecentAction[]> {
  const r = await db.query(
    `SELECT j.seq, j.occurred_at, j.action, j.subject_kind, j.subject_id, j.payload,
            o.display_name AS operator_name, u.full_name AS subject_name
       FROM admin_action_journal j
       LEFT JOIN operators o ON o.id = j.operator_id
       LEFT JOIN users u ON j.subject_kind = 'client' AND u.id::text = j.subject_id
      ORDER BY j.seq DESC
      LIMIT $1`,
    [limit],
  );
  return r.rows.map((row) => {
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    return {
      seq: Number(row.seq),
      occurredAt: new Date(row.occurred_at as string).toISOString(),
      action: String(row.action),
      operatorName: (row.operator_name as string | null) ?? null,
      subjectKind: String(row.subject_kind),
      subjectId: String(row.subject_id),
      subjectName: (row.subject_name as string | null) ?? null,
      basis: typeof payload.basis === 'string' && payload.basis ? payload.basis : null,
    };
  });
}
