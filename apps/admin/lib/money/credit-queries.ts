import { getPool } from '../db';
import type { MoneyCommandState } from './types';

export interface ManualCreditRow {
  id: string;
  userId: string;
  clientName: string | null;
  clientEmail: string | null;
  amountMinor: number;
  currency: string;
  state: MoneyCommandState;
  basis: string;
  initiatorId: string;
  initiatorName: string | null;
  initiatorRole: string;
  approverName: string | null;
  deciderName: string | null;
  bootstrapMode: boolean;
  resultCode: string | null;
  resultDetail: string | null;
  terminalSeq: number | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  executedAt: string | null;
}

interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

const iso = (v: unknown) => (v ? new Date(v as string | Date).toISOString() : null);

const SELECT = `
  SELECT c.id, c.account_id, u.full_name AS client_name, u.email AS client_email, c.amount_minor, c.currency,
         c.state, c.basis_ref, c.initiator_id, oi.display_name AS initiator_name, c.initiator_role,
         oa.display_name AS approver_name, od.display_name AS decider_name, c.bootstrap_mode,
         c.result_code, c.result_detail, c.terminal_seq, c.dispatch_attempts, c.created_at, c.updated_at, c.executed_at
    FROM money_commands c
    LEFT JOIN users u ON u.id = c.account_id
    LEFT JOIN operators oi ON oi.id = c.initiator_id
    LEFT JOIN money_command_approvals a ON a.command_id = c.id AND a.kind = 'second_approval'
    LEFT JOIN operators oa ON oa.id = a.approver_id
    LEFT JOIN operators od ON od.id = c.decided_by
   WHERE c.type = 'credit'`;

function toRow(x: Record<string, unknown>): ManualCreditRow {
  return {
    id: String(x.id),
    userId: String(x.account_id),
    clientName: (x.client_name as string | null) ?? null,
    clientEmail: (x.client_email as string | null) ?? null,
    amountMinor: Number(x.amount_minor),
    currency: String(x.currency),
    state: x.state as MoneyCommandState,
    basis: String(x.basis_ref),
    initiatorId: String(x.initiator_id),
    initiatorName: (x.initiator_name as string | null) ?? null,
    initiatorRole: String(x.initiator_role),
    approverName: (x.approver_name as string | null) ?? null,
    deciderName: (x.decider_name as string | null) ?? null,
    bootstrapMode: Boolean(x.bootstrap_mode),
    resultCode: (x.result_code as string | null) ?? null,
    resultDetail: (x.result_detail as string | null) ?? null,
    terminalSeq: x.terminal_seq === null || x.terminal_seq === undefined ? null : Number(x.terminal_seq),
    attempts: Number(x.dispatch_attempts ?? 0),
    createdAt: iso(x.created_at)!,
    updatedAt: iso(x.updated_at)!,
    executedAt: iso(x.executed_at),
  };
}

export async function listManualCredits(
  opts: { userId?: string; limit?: number } = {},
  db: Queryable = getPool(),
): Promise<ManualCreditRow[]> {
  const params: unknown[] = [];
  let where = '';
  if (opts.userId) {
    params.push(opts.userId);
    where = ` AND c.account_id = $${params.length}`;
  }
  params.push(Math.min(Math.max(opts.limit ?? 100, 1), 500));
  const r = await db.query(`${SELECT}${where} ORDER BY c.created_at DESC LIMIT $${params.length}`, params);
  return r.rows.map(toRow);
}
