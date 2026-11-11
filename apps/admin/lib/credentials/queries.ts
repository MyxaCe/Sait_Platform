import type { Queryable } from '@broker/money';
import { canEditClientCredentials } from '@/components/shell/sections';
import type { OperatorRole } from '../auth/session';
import { readCredentialSettings } from './core';
import { CREDENTIAL_ACTION_PREFIX, EDITABLE_WITHDRAWAL_STATUSES, RISKY_CREDENTIAL_ACTIONS, type CredentialSettings } from './policy';

/**
 * Чтения вкладки «Учётные данные» и сигналов службе безопасности (ТОЛЬКО
 * чтение, не журналируются). История изменений — из журнала карточки
 * (`client.credentials.*`), здесь — текущее состояние и права зрителя.
 */

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : new Date(v as string).toISOString());

export interface EditableWithdrawal {
  id: string;
  status: string;
  amountMinor: number;
  toAddress: string;
  requestedAt: string;
}

export interface CredentialsView {
  /** Может ли зритель править (admin или менеджер этого клиента). */
  canEdit: boolean;
  editorAs: 'admin' | 'manager' | null;
  passwordMustChange: boolean;
  tempPasswordExpiresAt: string | null;
  editableWithdrawals: EditableWithdrawal[];
  settings: CredentialSettings;
}

export async function getCredentialsView(
  db: Queryable,
  input: { userId: string; operatorId: string; role: OperatorRole | null | undefined },
): Promise<CredentialsView> {
  const [u, op, w, settings] = await Promise.all([
    db.query(`SELECT password_must_change, temp_password_expires_at FROM users WHERE id = $1`, [input.userId]),
    db.query(
      `SELECT o.is_client_manager,
              EXISTS (SELECT 1 FROM client_managers cm WHERE cm.user_id = $2 AND cm.manager_id = o.id) AS assigned
         FROM operators o WHERE o.id = $1 AND o.disabled_at IS NULL`,
      [input.operatorId, input.userId],
    ),
    db.query(
      `SELECT id, status, amount_minor, to_address, requested_at FROM crypto_withdrawals
        WHERE user_id = $1 AND status = ANY($2::text[]) AND payout_tx_hash IS NULL
        ORDER BY requested_at DESC`,
      [input.userId, [...EDITABLE_WITHDRAWAL_STATUSES]],
    ),
    readCredentialSettings(db),
  ]);
  const o = op.rows[0];
  const isAssignedManager = Boolean(o?.is_client_manager) && Boolean(o?.assigned);
  const canEdit = o !== undefined && canEditClientCredentials(input.role, { isAssignedManager });
  return {
    canEdit,
    editorAs: canEdit ? (input.role === 'admin' ? 'admin' : 'manager') : null,
    passwordMustChange: Boolean(u.rows[0]?.password_must_change),
    tempPasswordExpiresAt: iso(u.rows[0]?.temp_password_expires_at),
    editableWithdrawals: w.rows.map((r) => ({
      id: String(r.id),
      status: String(r.status),
      amountMinor: Number(r.amount_minor),
      toAddress: String(r.to_address),
      requestedAt: iso(r.requested_at)!,
    })),
    settings,
  };
}

export interface CredentialsAlertRow {
  operatorId: string;
  operatorName: string;
  count: number;
}

export interface CredentialsAlerts {
  /** Все правки учётных данных за 24 ч (включая заморозки). */
  total24h: number;
  /** Рискованные правки за 24 ч (email, пароль, адрес, снятие заморозки). */
  risky24h: number;
  threshold: number;
  /** Операторы, превысившие порог рискованных правок за 24 ч. */
  unusual: CredentialsAlertRow[];
}

/**
 * Счётчик необычной активности (информационно, НЕ блокирует): больше N
 * рискованных правок одним оператором за сутки, N — настройка платформы.
 */
export async function getCredentialsAlerts(db: Queryable, now: Date = new Date()): Promise<CredentialsAlerts> {
  const since = new Date(now.getTime() - 86_400_000);
  const settings = await readCredentialSettings(db);
  const [totals, per] = await Promise.all([
    db.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE action = ANY($2::text[]))::int AS risky
         FROM admin_action_journal
        WHERE action LIKE $3 AND occurred_at > $1`,
      [since, [...RISKY_CREDENTIAL_ACTIONS], `${CREDENTIAL_ACTION_PREFIX}%`],
    ),
    db.query(
      `SELECT j.operator_id, o.display_name, count(*)::int AS n
         FROM admin_action_journal j JOIN operators o ON o.id = j.operator_id
        WHERE j.action = ANY($2::text[]) AND j.occurred_at > $1
        GROUP BY j.operator_id, o.display_name
       HAVING count(*) > $3
        ORDER BY n DESC`,
      [since, [...RISKY_CREDENTIAL_ACTIONS], settings.alertPerOperatorDay],
    ),
  ]);
  return {
    total24h: Number(totals.rows[0]?.total ?? 0),
    risky24h: Number(totals.rows[0]?.risky ?? 0),
    threshold: settings.alertPerOperatorDay,
    unusual: per.rows.map((r) => ({ operatorId: String(r.operator_id), operatorName: String(r.display_name), count: Number(r.n) })),
  };
}
