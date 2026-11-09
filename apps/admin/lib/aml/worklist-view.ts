import { getPool, type Queryable } from '../db';
import { asState, type VerificationState } from '../clients/verification-state';
import { AML_STATUSES, asAmlStatus, normalizeSanctionsLists, type AmlStatus, type SanctionsListId } from './lists';

/**
 * Рабочий список AML для страницы `/aml` (редизайн, фаза 2) — только чтение.
 *
 * Та же популяция и тот же порядок срочности, что у `listAmlWorklist`
 * (`queries.ts`, оставлен без изменений): клиенты с заведённой верификацией;
 * сперва эскалации, затем не сверявшиеся (дольше ждущие выше), затем чистые.
 * Сверх него — кто сверял, по каким спискам, KYC-статус и блокировка (колонки
 * таблицы), фильтр по статусу и поиск. Пользовательский текст — параметрами.
 */

export interface AmlListRow {
  userId: string;
  fullName: string;
  email: string;
  status: AmlStatus;
  screenedAt: string | null;
  screenedByName: string | null;
  lists: SanctionsListId[];
  kyc: VerificationState;
  blocked: boolean;
  registeredAt: string;
}

export interface AmlListQuery {
  status: AmlStatus | 'all';
  q: string;
}

export function parseAmlListQuery(sp: Record<string, string | string[] | undefined>): AmlListQuery {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? '';
  const status = one(sp.status);
  return {
    status: (AML_STATUSES as readonly string[]).includes(status) ? (status as AmlStatus) : 'all',
    q: one(sp.q).slice(0, 200),
  };
}

export interface AmlCounts {
  total: number;
  escalated: number;
  unscreened: number;
  clear: number;
  /** Самая давняя сверка среди «чистых» (кандидат на пересверку). */
  oldestClearAt: string | null;
}

export async function listAmlRows(query: AmlListQuery, db: Queryable = getPool()): Promise<AmlListRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (query.status !== 'all') {
    params.push(query.status);
    where.push(`COALESCE(a.status, 'unscreened') = $${params.length}`);
  }
  if (query.q) {
    params.push(`%${query.q}%`);
    const p = `$${params.length}`;
    where.push(`(u.full_name ILIKE ${p} OR u.email ILIKE ${p} OR u.id::text ILIKE ${p})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const result = await db.query(
    `SELECT u.id, u.full_name, u.email, u.created_at,
            cv.state AS kyc,
            COALESCE(a.status, 'unscreened') AS status,
            a.screened_at, a.lists_checked,
            o.display_name AS screened_by_name,
            COALESCE(cb.blocked, false) AS blocked
       FROM client_verification cv
       JOIN users u ON u.id = cv.user_id
       LEFT JOIN client_aml_screening a ON a.user_id = cv.user_id
       LEFT JOIN operators o ON o.id = a.screened_by
       LEFT JOIN client_blocks cb ON cb.user_id = cv.user_id
      ${whereSql}
      ORDER BY CASE COALESCE(a.status, 'unscreened')
                 WHEN 'escalated' THEN 0
                 WHEN 'unscreened' THEN 1
                 ELSE 2
               END,
               a.screened_at ASC NULLS FIRST,
               u.created_at ASC
      LIMIT 500`,
    params,
  );

  return result.rows.map((r) => ({
    userId: r.id as string,
    fullName: r.full_name as string,
    email: r.email as string,
    status: asAmlStatus(r.status),
    screenedAt: r.screened_at ? new Date(r.screened_at as string | Date).toISOString() : null,
    screenedByName: (r.screened_by_name as string | null) ?? null,
    lists: normalizeSanctionsLists((r.lists_checked as unknown[] | null) ?? []),
    kyc: asState(r.kyc),
    blocked: Boolean(r.blocked),
    registeredAt: new Date(r.created_at as string | Date).toISOString(),
  }));
}

export async function getAmlCounts(db: Queryable = getPool()): Promise<AmlCounts> {
  const r = await db.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE a.status = 'escalated')::int AS escalated,
            count(*) FILTER (WHERE COALESCE(a.status, 'unscreened') = 'unscreened')::int AS unscreened,
            count(*) FILTER (WHERE a.status = 'clear')::int AS clear,
            min(a.screened_at) FILTER (WHERE a.status = 'clear') AS oldest_clear
       FROM client_verification cv
       LEFT JOIN client_aml_screening a ON a.user_id = cv.user_id`,
  );
  const row = r.rows[0] ?? {};
  return {
    total: Number(row.total ?? 0),
    escalated: Number(row.escalated ?? 0),
    unscreened: Number(row.unscreened ?? 0),
    clear: Number(row.clear ?? 0),
    oldestClearAt: row.oldest_clear ? new Date(row.oldest_clear as string | Date).toISOString() : null,
  };
}
