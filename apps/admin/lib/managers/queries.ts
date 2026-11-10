import { getPool, type Queryable } from '../db';
import { asState, type VerificationState } from '../clients/verification-state';

/**
 * Чтения «менеджеров клиентов» (ТОЛЬКО ЧТЕНИЕ, не журналируются — как реестр).
 * Пригодный менеджер = флаг `is_client_manager`, не отключён, не `system:*`,
 * роль видит раздел «Клиенты» (admin/operator/finance_operator — см. policy.ts;
 * в SQL тот же перечень, тест сверяет).
 */

export const MANAGER_ROLES_SQL = `('admin','operator','finance_operator')`;

export interface ManagerOption {
  id: string;
  displayName: string;
  role: string;
  clients: number;
}

/** Пригодные менеджеры с числом закреплённых клиентов — для фильтров и форм назначения. */
export async function listClientManagers(db: Queryable = getPool()): Promise<ManagerOption[]> {
  const r = await db.query(
    `SELECT o.id, o.display_name, o.role,
            (SELECT count(*) FROM client_managers cm WHERE cm.manager_id = o.id)::int AS clients
       FROM operators o
      WHERE o.is_client_manager AND o.disabled_at IS NULL
        AND o.login NOT LIKE 'system:%' AND o.role IN ${MANAGER_ROLES_SQL}
      ORDER BY lower(o.display_name)`,
  );
  return r.rows.map((row) => ({
    id: String(row.id),
    displayName: String(row.display_name),
    role: String(row.role),
    clients: Number(row.clients ?? 0),
  }));
}

/** Число закреплённых клиентов по каждому оператору (экран «Операторы»). */
export async function managerClientCounts(db: Queryable = getPool()): Promise<Map<string, number>> {
  const r = await db.query(`SELECT manager_id, count(*)::int AS n FROM client_managers GROUP BY manager_id`);
  return new Map(r.rows.map((row) => [String(row.manager_id), Number(row.n)]));
}

/** Помечен ли оператор как менеджер клиентов (по этому — «Мои клиенты» по умолчанию). */
export async function isClientManager(operatorId: string, db: Queryable = getPool()): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM operators WHERE id = $1 AND is_client_manager AND disabled_at IS NULL`,
    [operatorId],
  );
  return r.rows.length > 0;
}

export interface ClientManagerInfo {
  managerId: string;
  managerName: string;
  assignedAt: string;
  assignedByName: string | null;
  reason: string;
}

export async function getClientManager(userId: string, db: Queryable = getPool()): Promise<ClientManagerInfo | null> {
  const r = await db.query(
    `SELECT cm.manager_id, m.display_name AS manager_name, cm.assigned_at, cm.reason,
            a.display_name AS assigned_by_name
       FROM client_managers cm
       JOIN operators m ON m.id = cm.manager_id
       LEFT JOIN operators a ON a.id = cm.assigned_by
      WHERE cm.user_id = $1`,
    [userId],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    managerId: String(row.manager_id),
    managerName: String(row.manager_name),
    assignedAt: new Date(row.assigned_at as string | Date).toISOString(),
    assignedByName: (row.assigned_by_name as string | null) ?? null,
    reason: String(row.reason),
  };
}

export interface MyClientsSummary {
  total: number;
  kycPending: number;
  kycNotStarted: number;
  /** Зачисленные депозиты моих клиентов за 7 дней: штук и сумма (минорные USDT). */
  deposits7d: number;
  deposits7dMinor: number;
  /** Выводы моих клиентов, ждущие решения. */
  withdrawalsPending: number;
  /** Входили в кабинет за 7 дней. */
  active7d: number;
  /** Не входили 30 дней или никогда. */
  dormant30d: number;
}

export async function getMyClientsSummary(managerId: string, db: Queryable = getPool()): Promise<MyClientsSummary> {
  const r = await db.query(
    `WITH mine AS (SELECT user_id FROM client_managers WHERE manager_id = $1)
     SELECT
       (SELECT count(*) FROM mine)::int AS total,
       (SELECT count(*) FROM mine m JOIN client_verification cv ON cv.user_id = m.user_id
         WHERE cv.state = 'pending')::int AS kyc_pending,
       (SELECT count(*) FROM mine m LEFT JOIN client_verification cv ON cv.user_id = m.user_id
         WHERE COALESCE(cv.state, 'unverified') = 'unverified')::int AS kyc_not_started,
       (SELECT count(*) FROM crypto_deposits d JOIN mine m ON m.user_id = d.user_id
         WHERE d.status = 'credited' AND d.credited_at > now() - interval '7 days')::int AS dep7,
       (SELECT coalesce(sum(d.amount_minor), 0) FROM crypto_deposits d JOIN mine m ON m.user_id = d.user_id
         WHERE d.status = 'credited' AND d.credited_at > now() - interval '7 days')::bigint AS dep7_minor,
       (SELECT count(*) FROM crypto_withdrawals w JOIN mine m ON m.user_id = w.user_id
         WHERE w.status IN ('requested','needs_review'))::int AS wp,
       (SELECT count(*) FROM mine m JOIN users u ON u.id = m.user_id
         WHERE u.last_login_at > now() - interval '7 days')::int AS active7,
       (SELECT count(*) FROM mine m JOIN users u ON u.id = m.user_id
         WHERE u.last_login_at IS NULL OR u.last_login_at < now() - interval '30 days')::int AS dormant30`,
    [managerId],
  );
  const row = (r.rows[0] ?? {}) as Record<string, number | string>;
  const n = (v: number | string | undefined) => Number(v ?? 0);
  return {
    total: n(row.total),
    kycPending: n(row.kyc_pending),
    kycNotStarted: n(row.kyc_not_started),
    deposits7d: n(row.dep7),
    deposits7dMinor: n(row.dep7_minor),
    withdrawalsPending: n(row.wp),
    active7d: n(row.active7),
    dormant30d: n(row.dormant30),
  };
}

export interface MyClientRow {
  userId: string;
  fullName: string;
  email: string;
  kyc: VerificationState;
  lastLoginAt: string | null;
  balanceMinor: number | null;
  /** Последний зачисленный депозит. */
  lastDepositAt: string | null;
}

/**
 * «Мои клиенты» для дашборда: сначала те, кто ждёт действия (KYC на проверке,
 * затем не начат), внутри — по последней активности.
 */
export async function listMyClients(managerId: string, limit = 8, db: Queryable = getPool()): Promise<MyClientRow[]> {
  const r = await db.query(
    `SELECT u.id, u.full_name, u.email, u.last_login_at,
            COALESCE(cv.state, 'unverified') AS kyc,
            ra.balance_cents,
            (SELECT max(d.credited_at) FROM crypto_deposits d
              WHERE d.user_id = u.id AND d.status = 'credited') AS last_deposit_at
       FROM client_managers cm
       JOIN users u ON u.id = cm.user_id
       LEFT JOIN client_verification cv ON cv.user_id = u.id
       LEFT JOIN real_accounts ra ON ra.user_id = u.id
      WHERE cm.manager_id = $1
      ORDER BY CASE COALESCE(cv.state, 'unverified') WHEN 'pending' THEN 0 WHEN 'unverified' THEN 1 ELSE 2 END,
               u.last_login_at DESC NULLS LAST, u.created_at DESC
      LIMIT $2`,
    [managerId, limit],
  );
  return r.rows.map((row) => ({
    userId: String(row.id),
    fullName: String(row.full_name),
    email: String(row.email),
    kyc: asState(row.kyc),
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at as string | Date).toISOString() : null,
    balanceMinor: row.balance_cents === null || row.balance_cents === undefined ? null : Number(row.balance_cents),
    lastDepositAt: row.last_deposit_at ? new Date(row.last_deposit_at as string | Date).toISOString() : null,
  }));
}
