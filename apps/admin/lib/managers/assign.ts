import type { PoolClient } from 'pg';
import { getPool, type Queryable } from '../db';
import { appendJournalEntry } from '../journal/journal';
import { asRole } from '../operators/queries';
import { BULK_ASSIGN_LIMIT, isUuid, roleCanManageClients } from './policy';

/**
 * Закрепление менеджера за клиентами и флаг «менеджер клиентов» —
 * транзакционное ядро (образец — `lib/clients/block.ts`).
 *
 * Одно решение = одна транзакция: смена `client_managers` + запись в
 * неизменяемый журнал + привязка `last_journal_seq`. Массовое назначение — та
 * же транзакция на всю пачку: либо закреплены все выбранные, либо ни один
 * (частично применённая пачка — худшее для разбора «кто кому назначен»).
 *
 * Журнал — ПО ЗАПИСИ НА КЛИЕНТА (субъект — клиент): тогда смена видна в ленте
 * карточки каждого клиента. Массовость отмечена в payload (`bulk`, размер
 * пачки) — по ней в журнале видно, что это одна операция.
 *
 * Роль-гейт (только admin) — на server action-е (fail-closed); сюда приходит
 * уже проверенный `actorId` из сессии (Р-451).
 */

export interface AssignInput {
  /** `operators.id` автора — из серверной сессии, НЕ из формы. */
  actorId: string;
  userIds: string[];
  /** `null` — снять закрепление. */
  managerId: string | null;
  reason: string;
}

export type AssignResult =
  | { ok: true; changed: number; unchanged: number }
  | {
      ok: false;
      reason:
        | 'missingReason'
        | 'noClients'
        | 'tooMany'
        | 'invalidClient'
        | 'noClient'
        | 'invalidManager'
        | 'managerNotEligible';
    };

interface ManagerRow {
  id: string;
  displayName: string;
}

/** Менеджер пригоден: существует, не отключён, флаг стоит, роль видит «Клиентов». */
async function loadEligibleManager(db: Queryable, managerId: string): Promise<ManagerRow | null> {
  const r = await db.query(
    `SELECT id, display_name, role, is_client_manager, disabled_at
       FROM operators WHERE id = $1`,
    [managerId],
  );
  const row = r.rows[0] as
    | { id: string; display_name: string; role: string; is_client_manager: boolean; disabled_at: unknown }
    | undefined;
  if (!row) return null;
  if (row.disabled_at || !row.is_client_manager) return null;
  let role;
  try {
    role = asRole(row.role);
  } catch {
    return null;
  }
  if (!roleCanManageClients(role)) return null;
  return { id: row.id, displayName: row.display_name };
}

async function seqOf(db: Queryable, entryHash: string): Promise<number> {
  const r = await db.query(`SELECT seq FROM admin_action_journal WHERE entry_hash = $1`, [entryHash]);
  const seq = Number((r.rows[0] as { seq: number | string } | undefined)?.seq);
  if (!Number.isFinite(seq)) throw new Error('не удалось получить seq записи журнала закрепления');
  return seq;
}

export async function assignClientManagers(
  input: AssignInput,
  pool: { connect(): Promise<PoolClient> } = getPool(),
): Promise<AssignResult> {
  const reason = input.reason?.trim() ?? '';
  if (reason.length === 0) return { ok: false, reason: 'missingReason' };

  const userIds = [...new Set(input.userIds.map((u) => u.trim().toLowerCase()).filter(Boolean))];
  if (userIds.length === 0) return { ok: false, reason: 'noClients' };
  if (userIds.length > BULK_ASSIGN_LIMIT) return { ok: false, reason: 'tooMany' };
  if (!userIds.every(isUuid)) return { ok: false, reason: 'invalidClient' };
  if (input.managerId !== null && !isUuid(input.managerId)) return { ok: false, reason: 'invalidManager' };

  const bulk = userIds.length > 1;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const db = client as unknown as Queryable;

    let manager: ManagerRow | null = null;
    if (input.managerId !== null) {
      manager = await loadEligibleManager(db, input.managerId);
      if (!manager) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'managerNotEligible' };
      }
    }

    const users = await db.query(`SELECT id FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
    if (users.rows.length !== userIds.length) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'noClient' };
    }

    // Текущее закрепление выбранных клиентов — под блокировкой строк (гонка двух админов).
    const cur = await db.query(
      `SELECT cm.user_id, cm.manager_id, o.display_name
         FROM client_managers cm JOIN operators o ON o.id = cm.manager_id
        WHERE cm.user_id = ANY($1::uuid[])
        FOR UPDATE OF cm`,
      [userIds],
    );
    const current = new Map<string, { managerId: string; name: string }>();
    for (const r of cur.rows as { user_id: string; manager_id: string; display_name: string }[]) {
      current.set(String(r.user_id).toLowerCase(), { managerId: String(r.manager_id).toLowerCase(), name: r.display_name });
    }

    let changed = 0;
    let unchanged = 0;
    for (const userId of userIds) {
      const prev = current.get(userId) ?? null;
      const target = manager?.id.toLowerCase() ?? null;
      if ((prev?.managerId ?? null) === target) {
        // Содержательного перехода нет — пустых записей в журнал не пишем.
        unchanged += 1;
        continue;
      }

      if (manager) {
        await db.query(
          `INSERT INTO client_managers (user_id, manager_id, assigned_by, assigned_at, reason)
                VALUES ($1, $2, $3, now(), $4)
           ON CONFLICT (user_id) DO UPDATE
                SET manager_id = EXCLUDED.manager_id,
                    assigned_by = EXCLUDED.assigned_by,
                    assigned_at = now(),
                    reason = EXCLUDED.reason,
                    last_journal_seq = NULL`,
          [userId, manager.id, input.actorId, reason],
        );
      } else {
        await db.query(`DELETE FROM client_managers WHERE user_id = $1`, [userId]);
      }

      const entry = await appendJournalEntry(
        {
          operatorId: input.actorId,
          action: manager ? 'client.manager_assigned' : 'client.manager_unassigned',
          subjectKind: 'client',
          subjectId: userId,
          payload: {
            basis: reason,
            managerId: manager?.id ?? null,
            managerName: manager?.displayName ?? null,
            previousManagerId: prev?.managerId ?? null,
            previousManagerName: prev?.name ?? null,
            ...(bulk ? { bulk: true, batchSize: userIds.length } : {}),
          },
        },
        db,
      );
      if (manager) {
        const seq = await seqOf(db, entry.entryHash);
        await db.query(`UPDATE client_managers SET last_journal_seq = $2 WHERE user_id = $1`, [userId, seq]);
      }
      changed += 1;
    }

    await client.query('COMMIT');
    return { ok: true, changed, unchanged };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export interface ManagerFlagInput {
  actorId: string;
  operatorId: string;
  enabled: boolean;
  reason: string;
}

export type ManagerFlagResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'missingReason' | 'invalidSubject' | 'notFound' | 'notActive' | 'roleNotEligible' | 'noChange' | 'hasClients';
    };

/**
 * Флаг «менеджер клиентов» у оператора (только admin). Снять флаг с менеджера,
 * за которым ещё закреплены клиенты, нельзя (`hasClients`): сначала клиентов
 * передают другому менеджеру — «ничьих по ошибке» клиентов не бывает.
 */
export async function setClientManagerFlag(
  input: ManagerFlagInput,
  pool: { connect(): Promise<PoolClient> } = getPool(),
): Promise<ManagerFlagResult> {
  const reason = input.reason?.trim() ?? '';
  if (reason.length === 0) return { ok: false, reason: 'missingReason' };
  if (!isUuid(input.operatorId)) return { ok: false, reason: 'invalidSubject' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const db = client as unknown as Queryable;
    const r = await db.query(
      `SELECT role, is_client_manager, disabled_at, login FROM operators WHERE id = $1 FOR UPDATE`,
      [input.operatorId],
    );
    const row = r.rows[0] as
      | { role: string; is_client_manager: boolean; disabled_at: unknown; login: string }
      | undefined;
    const fail = async (reason: Exclude<ManagerFlagResult, { ok: true }>['reason']): Promise<ManagerFlagResult> => {
      await client.query('ROLLBACK');
      return { ok: false, reason };
    };
    if (!row || row.login.startsWith('system:')) return fail('notFound');
    if (row.disabled_at) return fail('notActive');
    if (Boolean(row.is_client_manager) === input.enabled) return fail('noChange');
    if (input.enabled && !roleCanManageClients(asRole(row.role))) return fail('roleNotEligible');

    let clients = 0;
    if (!input.enabled) {
      const c = await db.query(`SELECT count(*)::int AS n FROM client_managers WHERE manager_id = $1`, [input.operatorId]);
      clients = Number((c.rows[0] as { n: number } | undefined)?.n ?? 0);
      if (clients > 0) return fail('hasClients');
    }

    await db.query(`UPDATE operators SET is_client_manager = $2 WHERE id = $1`, [input.operatorId, input.enabled]);
    await appendJournalEntry(
      {
        operatorId: input.actorId,
        action: input.enabled ? 'operator.client_manager_granted' : 'operator.client_manager_revoked',
        subjectKind: 'operator',
        subjectId: input.operatorId,
        payload: { basis: reason },
      },
      db,
    );
    await client.query('COMMIT');
    return { ok: true };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
