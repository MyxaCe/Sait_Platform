import { getPool, type Queryable } from '../db';
import type { OperatorRole } from '../auth/session';

export interface OperatorListItem {
  id: string;
  login: string;
  displayName: string;
  role: OperatorRole;
  createdAt: string;
  disabledAt: string | null;
  totpEnrolled: boolean;
  isClientManager: boolean;
}

export function asRole(value: unknown): OperatorRole {
  if (value === 'admin' || value === 'operator' || value === 'finance_operator' || value === 'support_operator') return value;
  throw new Error(`operators.role вне допустимого множества: ${String(value)}`);
}

export async function listOperators(db: Queryable = getPool()): Promise<OperatorListItem[]> {
  const result = await db.query(
    `SELECT id, login, display_name, role, created_at, disabled_at, totp_enrolled_at, is_client_manager
       FROM operators
      ORDER BY created_at DESC`,
  );
  return result.rows.map((r) => ({
    id: r.id as string,
    login: r.login as string,
    displayName: r.display_name as string,
    role: asRole(r.role),
    createdAt: new Date(r.created_at as string | Date).toISOString(),
    disabledAt: r.disabled_at ? new Date(r.disabled_at as string | Date).toISOString() : null,
    totpEnrolled: r.totp_enrolled_at !== null && r.totp_enrolled_at !== undefined,
    isClientManager: Boolean(r.is_client_manager),
  }));
}
