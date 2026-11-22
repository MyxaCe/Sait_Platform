import { getPool, type Queryable } from '../db';
import {
  asAmlStatus,
  normalizeSanctionsLists,
  type AmlStatus,
  type SanctionsListId,
} from './lists';

export interface AmlWorklistRow {
  userId: string;
  fullName: string;
  email: string;
  status: AmlStatus;
  screenedAt: string | null;
}

export async function listAmlWorklist(db: Queryable = getPool()): Promise<AmlWorklistRow[]> {
  const result = await db.query(
    `SELECT u.id,
            u.full_name,
            u.email,
            COALESCE(a.status, 'unscreened') AS status,
            a.screened_at
       FROM client_verification cv
       JOIN users u ON u.id = cv.user_id
       LEFT JOIN client_aml_screening a ON a.user_id = cv.user_id
      ORDER BY CASE COALESCE(a.status, 'unscreened')
                 WHEN 'escalated' THEN 0
                 WHEN 'unscreened' THEN 1
                 ELSE 2
               END,
               a.screened_at ASC NULLS FIRST,
               u.created_at ASC
      LIMIT 500`,
  );
  return result.rows.map((r) => ({
    userId: r.id as string,
    fullName: r.full_name as string,
    email: r.email as string,
    status: asAmlStatus(r.status),
    screenedAt: r.screened_at ? new Date(r.screened_at as string | Date).toISOString() : null,
  }));
}

export interface AmlScreeningHistoryEntry {
  seq: number;
  occurredAt: string;
  action: string;
  operatorName: string | null;
  basis: string | null;
  lists: SanctionsListId[];
  outcome: AmlStatus;
}

export interface AmlCard {
  userId: string;
  fullName: string;
  email: string;
  status: AmlStatus;
  reason: string | null;
  listsChecked: SanctionsListId[];
  screenedAt: string | null;
  screenedByName: string | null;
  blocked: boolean;
  blockReason: string | null;
  history: AmlScreeningHistoryEntry[];
}

function asHistoryOutcome(action: string): AmlStatus {
  if (action === 'client.aml_escalated') return 'escalated';
  if (action === 'client.aml_checked') return 'clear';
  if (action === 'client.aml_escalation_cleared') return 'clear';
  return 'unscreened';
}

export async function getAmlCard(
  userId: string,
  db: Queryable = getPool(),
): Promise<AmlCard | null> {
  const head = await db.query(
    `SELECT u.id,
            u.full_name,
            u.email,
            a.status,
            a.lists_checked,
            a.reason,
            a.screened_at,
            o.display_name AS screened_by_name,
            COALESCE(cb.blocked, false) AS blocked,
            cb.reason AS block_reason
       FROM users u
       LEFT JOIN client_aml_screening a ON a.user_id = u.id
       LEFT JOIN operators o ON o.id = a.screened_by
       LEFT JOIN client_blocks cb ON cb.user_id = u.id
      WHERE u.id = $1`,
    [userId],
  );
  const row = head.rows[0];
  if (!row) return null;

  const hist = await db.query(
    `SELECT j.seq, j.occurred_at, j.action, j.payload, o.display_name AS operator_name
       FROM admin_action_journal j
       LEFT JOIN operators o ON o.id = j.operator_id
      WHERE j.subject_kind = 'client'
        AND j.subject_id = $1
        AND j.action IN ('client.aml_checked', 'client.aml_escalated', 'client.aml_escalation_cleared')
      ORDER BY j.seq DESC`,
    [userId],
  );

  return {
    userId: row.id as string,
    fullName: row.full_name as string,
    email: row.email as string,
    status: asAmlStatus(row.status ?? 'unscreened'),
    reason: (row.reason as string | null) ?? null,
    listsChecked: normalizeSanctionsLists((row.lists_checked as unknown[] | null) ?? []),
    screenedAt: row.screened_at ? new Date(row.screened_at as string | Date).toISOString() : null,
    screenedByName: (row.screened_by_name as string | null) ?? null,
    blocked: Boolean(row.blocked),
    blockReason: (row.block_reason as string | null) ?? null,
    history: hist.rows.map((h) => {
      const payload = (h.payload as Record<string, unknown> | null) ?? {};
      return {
        seq: Number(h.seq),
        occurredAt: new Date(h.occurred_at as string | Date).toISOString(),
        action: h.action as string,
        operatorName: (h.operator_name as string | null) ?? null,
        basis: typeof payload.basis === 'string' ? payload.basis : null,
        lists: normalizeSanctionsLists(Array.isArray(payload.lists) ? payload.lists : []),
        outcome: asHistoryOutcome(h.action as string),
      };
    }),
  };
}
