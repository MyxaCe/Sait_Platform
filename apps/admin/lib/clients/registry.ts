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
  /** Закреплённый менеджер (`client_managers`); `null` — не закреплён. */
  managerId: string | null;
  managerName: string | null;
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
  /** `operators.id` зрителя — для фильтра «Мои клиенты» (из сессии, не из URL). */
  viewerId: string | null = null,
): Promise<RegistryPage> {
  const where: string[] = [];
  const params: unknown[] = [];

  // Менеджер. «Мои» без известного зрителя — пустой результат (fail-closed),
  // а не «все»: иначе сбой сессии показал бы менеджеру чужой портфель как свой.
  if (query.mgr === 'mine') {
    if (viewerId) {
      params.push(viewerId);
      where.push(`cm.manager_id = $${params.length}`);
    } else {
      where.push('false');
    }
  } else if (query.mgr === 'none') {
    where.push('cm.manager_id IS NULL');
  } else if (typeof query.mgr === 'object') {
    params.push(query.mgr.managerId);
    where.push(`cm.manager_id = $${params.length}`);
  }

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
       LEFT JOIN client_managers cm ON cm.user_id = u.id
       LEFT JOIN operators mo ON mo.id = cm.manager_id
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
              ra.balance_cents, ra.currency,
              cm.manager_id, mo.display_name AS manager_name
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
      managerId: (r.manager_id as string | null) ?? null,
      managerName: (r.manager_name as string | null) ?? null,
    })),
  };
}
