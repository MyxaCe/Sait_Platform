import { getPool, type Queryable } from '../db';
import { asAmlStatus, type AmlStatus } from '../aml/lists';
import { asState, type VerificationState } from './verification-state';
import {
  REGISTRY_PAGE_SIZE,
  type RegistryQuery,
  type RegistrySortKey,
} from './registry-params';

/**
 * Реестр клиентов `/clients` — ЧТЕНИЕ для представления (редизайн, фаза 2).
 *
 * Отличие от `listClients` (`queries.ts`, оставлен без изменений): реестру нужны
 * AML-статус, денежные ограничения (заморозка / запрет вывода), серверная
 * пагинация с общим счётчиком и сортировка по заголовку колонки в обе стороны.
 * Только SELECT, ничего не пишет; чтение не журналируется (§3.1 дизайна).
 *
 * Безопасность SQL: пользовательский текст идёт только параметрами (`$n`);
 * сортировка — из закрытого whitelist (`SORT_SQL`), направление — из `asc|desc`.
 */

export interface RegistryRow {
  userId: string;
  fullName: string;
  email: string;
  registeredAt: string;
  lastLoginAt: string | null;
  kyc: VerificationState;
  aml: AmlStatus;
  blocked: boolean;
  frozen: boolean;
  withdrawBanned: boolean;
  /** Баланс реального счёта (проекция `real_accounts`), минорные единицы; `null` — счёта нет. */
  balanceMinor: number | null;
  currency: string | null;
}

export interface RegistryPage {
  rows: RegistryRow[];
  total: number;
}

const SORT_SQL: Record<RegistrySortKey, string> = {
  name: 'lower(u.full_name)',
  registered: 'u.created_at',
  activity: 'u.last_login_at',
  balance: 'ra.balance_cents',
};

export async function listClientRegistry(
  query: RegistryQuery,
  db: Queryable = getPool(),
): Promise<RegistryPage> {
  const where: string[] = [];
  const params: unknown[] = [];

  if (query.q) {
    params.push(`%${query.q}%`);
    const p = `$${params.length}`;
    where.push(`(u.full_name ILIKE ${p} OR u.email ILIKE ${p} OR u.id::text ILIKE ${p})`);
  }
  if (query.kyc !== 'all') {
    params.push(query.kyc);
    where.push(`COALESCE(cv.state, 'unverified') = $${params.length}`);
  }
  if (query.aml !== 'all') {
    params.push(query.aml);
    where.push(`COALESCE(a.status, 'unscreened') = $${params.length}`);
  }
  if (query.access === 'blocked') where.push('COALESCE(cb.blocked, false)');
  if (query.access === 'active') where.push('NOT COALESCE(cb.blocked, false)');
  if (query.access === 'restricted') {
    where.push('(COALESCE(mf.frozen, false) OR COALESCE(mf.withdraw_banned, false))');
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const dir = query.dir === 'asc' ? 'ASC' : 'DESC';
  // NULL (нет счёта / не входил) — всегда в конце, в обе стороны.
  const orderSql = `${SORT_SQL[query.sort]} ${dir} NULLS LAST, u.created_at DESC, u.id`;

  const from = `FROM users u
       LEFT JOIN client_verification cv ON cv.user_id = u.id
       LEFT JOIN client_aml_screening a ON a.user_id = u.id
       LEFT JOIN client_blocks cb ON cb.user_id = u.id
       LEFT JOIN client_money_flags mf ON mf.user_id = u.id
       LEFT JOIN real_accounts ra ON ra.user_id = u.id
       ${whereSql}`;

  const offset = (query.page - 1) * REGISTRY_PAGE_SIZE;
  const [count, page] = await Promise.all([
    db.query(`SELECT count(*)::int AS n ${from}`, params),
    db.query(
      `SELECT u.id, u.full_name, u.email, u.created_at, u.last_login_at,
              COALESCE(cv.state, 'unverified') AS kyc,
              COALESCE(a.status, 'unscreened') AS aml,
              COALESCE(cb.blocked, false) AS blocked,
              COALESCE(mf.frozen, false) AS frozen,
              COALESCE(mf.withdraw_banned, false) AS withdraw_banned,
              ra.balance_cents, ra.currency
         ${from}
        ORDER BY ${orderSql}
        LIMIT ${REGISTRY_PAGE_SIZE} OFFSET ${offset}`,
      params,
    ),
  ]);

  return {
    total: Number(count.rows[0]?.n ?? 0),
    rows: page.rows.map((r) => ({
      userId: r.id as string,
      fullName: r.full_name as string,
      email: r.email as string,
      registeredAt: new Date(r.created_at as string | Date).toISOString(),
      lastLoginAt: r.last_login_at ? new Date(r.last_login_at as string | Date).toISOString() : null,
      kyc: asState(r.kyc),
      aml: asAmlStatus(r.aml),
      blocked: Boolean(r.blocked),
      frozen: Boolean(r.frozen),
      withdrawBanned: Boolean(r.withdraw_banned),
      balanceMinor:
        r.balance_cents === null || r.balance_cents === undefined ? null : Number(r.balance_cents),
      currency: (r.currency as string | null) ?? null,
    })),
  };
}
