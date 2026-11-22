import { getPool, type Queryable } from '@/lib/db';
import type { OperatorRole } from '@/lib/auth/session';
import type { ChainRow } from './verify-chain';

export interface JournalRow {
  seq: number;
  occurredAt: string;
  operatorId: string;
  operatorLogin: string;
  operatorName: string;
  action: string;
  subjectKind: string;
  subjectId: string;
  payload: Record<string, unknown>;
  prevHash: string | null;
  entryHash: string;
}

export interface JournalFilters {
  operatorId?: string;
  action?: string;
  subjectKind?: string;
  subjectId?: string;
  from?: string;
  to?: string;
}

export interface JournalListOptions {
  role: OperatorRole;
  selfOperatorId: string;
  filters: JournalFilters;
  limit?: number;
  offset?: number;
}

export interface OperatorOption {
  id: string;
  login: string;
  displayName: string;
}

function toRow(r: Record<string, unknown>): JournalRow {
  return {
    seq: Number(r.seq),
    occurredAt: new Date(r.occurred_at as string | Date).toISOString(),
    operatorId: r.operator_id as string,
    operatorLogin: r.operator_login as string,
    operatorName: r.operator_name as string,
    action: r.action as string,
    subjectKind: r.subject_kind as string,
    subjectId: r.subject_id as string,
    payload: (r.payload as Record<string, unknown> | null) ?? {},
    prevHash: (r.prev_hash as string | null) ?? null,
    entryHash: r.entry_hash as string,
  };
}

function buildWhere(opts: Pick<JournalListOptions, 'role' | 'selfOperatorId' | 'filters'>): {
  whereSql: string;
  params: unknown[];
} {
  const params: unknown[] = [];
  const where: string[] = [];

  if (opts.role !== 'admin') {
    params.push(opts.selfOperatorId);
    where.push(`(j.operator_id = $${params.length} OR j.subject_kind <> 'operator')`);
  }

  const f = opts.filters;
  if (f.operatorId) {
    params.push(f.operatorId);
    where.push(`j.operator_id = $${params.length}`);
  }
  if (f.action) {
    const prefix = f.action.endsWith('.*') ? f.action.slice(0, -1) : null;
    if (prefix !== null && /^[a-z_.]+$/.test(prefix)) {
      params.push(`${prefix.replaceAll('_', '\\_')}%`);
      where.push(`j.action LIKE $${params.length}`);
    } else {
      params.push(f.action);
      where.push(`j.action = $${params.length}`);
    }
  }
  if (f.subjectKind) {
    params.push(f.subjectKind);
    where.push(`j.subject_kind = $${params.length}`);
  }
  if (f.subjectId) {
    params.push(f.subjectId);
    where.push(`j.subject_id = $${params.length}`);
  }
  if (f.from) {
    params.push(f.from);
    where.push(`j.occurred_at >= $${params.length}`);
  }
  if (f.to) {
    params.push(f.to);
    where.push(`j.occurred_at <= $${params.length}`);
  }

  return { whereSql: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '', params };
}

export async function listJournalEntries(
  opts: JournalListOptions,
  db: Queryable = getPool(),
): Promise<JournalRow[]> {
  const { whereSql, params } = buildWhere(opts);
  const limit = Math.max(1, Math.min(opts.limit ?? 500, 100_000));
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));

  const result = await db.query(
    `SELECT j.seq, j.occurred_at, j.operator_id, j.action, j.subject_kind, j.subject_id,
            j.payload, j.prev_hash, j.entry_hash,
            o.login AS operator_login, o.display_name AS operator_name
       FROM admin_action_journal j
       JOIN operators o ON o.id = j.operator_id
       ${whereSql}
      ORDER BY j.seq DESC
      LIMIT ${limit}${offset > 0 ? ` OFFSET ${offset}` : ''}`,
    params,
  );
  return result.rows.map(toRow);
}

export async function countJournalEntries(
  opts: Pick<JournalListOptions, 'role' | 'selfOperatorId' | 'filters'>,
  db: Queryable = getPool(),
): Promise<number> {
  const { whereSql, params } = buildWhere(opts);
  const result = await db.query(
    `SELECT COUNT(*)::int AS n FROM admin_action_journal j ${whereSql}`,
    params,
  );
  return Number(result.rows[0]?.n ?? 0);
}

export interface JournalTotals {
  total: number;
  lastSeq: number | null;
  lastAt: string | null;
}

export async function getJournalTotals(db: Queryable = getPool()): Promise<JournalTotals> {
  const result = await db.query(
    `SELECT COUNT(*)::int AS n, MAX(seq) AS last_seq, MAX(occurred_at) AS last_at
       FROM admin_action_journal`,
  );
  const r = result.rows[0] ?? {};
  return {
    total: Number(r.n ?? 0),
    lastSeq: r.last_seq == null ? null : Number(r.last_seq),
    lastAt: r.last_at ? new Date(r.last_at as string | Date).toISOString() : null,
  };
}

export async function resolveSubjectNames(
  rows: Pick<JournalRow, 'subjectKind' | 'subjectId'>[],
  db: Queryable = getPool(),
): Promise<Map<string, string>> {
  const ids = (kind: string) => [
    ...new Set(rows.filter((r) => r.subjectKind === kind).map((r) => r.subjectId)),
  ];
  const clients = ids('client');
  const operators = ids('operator');
  const portfolios = ids('leverage_portfolio');
  const out = new Map<string, string>();

  const [c, o, p] = await Promise.all([
    clients.length
      ? db.query(`SELECT id::text AS id, full_name AS name FROM users WHERE id::text = ANY($1)`, [
          clients,
        ])
      : null,
    operators.length
      ? db.query(
          `SELECT id::text AS id, display_name AS name FROM operators WHERE id::text = ANY($1)`,
          [operators],
        )
      : null,
    portfolios.length
      ? db.query(`SELECT key AS id, title AS name FROM leverage_portfolios WHERE key = ANY($1)`, [
          portfolios,
        ])
      : null,
  ]);
  const pairs: [string, { rows: Record<string, unknown>[] } | null][] = [
    ['client', c],
    ['operator', o],
    ['leverage_portfolio', p],
  ];
  for (const [kind, res] of pairs) {
    for (const row of res?.rows ?? []) out.set(`${kind}:${String(row.id)}`, String(row.name));
  }
  return out;
}

export async function loadChainRows(db: Queryable = getPool()): Promise<ChainRow[]> {
  const result = await db.query(
    `SELECT seq, occurred_at, operator_id, action, subject_kind, subject_id,
            payload, prev_hash, entry_hash
       FROM admin_action_journal
      ORDER BY seq ASC`,
  );
  return result.rows.map((r) => ({
    seq: Number(r.seq),
    occurredAt: new Date(r.occurred_at as string | Date).toISOString(),
    operatorId: r.operator_id as string,
    action: r.action as string,
    subjectKind: r.subject_kind as string,
    subjectId: r.subject_id as string,
    payload: (r.payload as Record<string, unknown> | null) ?? {},
    prevHash: (r.prev_hash as string | null) ?? null,
    entryHash: r.entry_hash as string,
  }));
}

export async function listOperatorsForFilter(db: Queryable = getPool()): Promise<OperatorOption[]> {
  const result = await db.query(
    `SELECT id, login, display_name FROM operators ORDER BY display_name ASC`,
  );
  return result.rows.map((r) => ({
    id: r.id as string,
    login: r.login as string,
    displayName: r.display_name as string,
  }));
}

export async function listDistinctActions(db: Queryable = getPool()): Promise<string[]> {
  const result = await db.query(
    `SELECT DISTINCT action FROM admin_action_journal ORDER BY action ASC`,
  );
  return result.rows.map((r) => r.action as string);
}

export async function listDistinctSubjectKinds(db: Queryable = getPool()): Promise<string[]> {
  const result = await db.query(
    `SELECT DISTINCT subject_kind FROM admin_action_journal ORDER BY subject_kind ASC`,
  );
  return result.rows.map((r) => r.subject_kind as string);
}
