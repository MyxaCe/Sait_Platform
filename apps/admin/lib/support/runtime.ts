import type { PoolLike } from '@broker/money';
import { asSupportRole, supportAccess, type Actor } from '@broker/support';
import { getOperatorSession } from '../auth/current';
import { getPool } from '../db';

/** Связка админки с `@broker/support`: пул в форме пакета и актор из сессии. */
export function supportPool(): PoolLike {
  return getPool() as unknown as PoolLike;
}

/**
 * Актор поддержки из ВАЛИДНОЙ сессии (личность не из формы, Р-451). `null` —
 * нет сессии или роль не работает с обращениями (fail-closed).
 */
export async function supportActor(): Promise<Actor | null> {
  const op = await getOperatorSession();
  if (!op) return null;
  const role = asSupportRole(op.role);
  if (!supportAccess.worksTickets(role)) return null;
  return { operatorId: op.operatorId, role: role!, displayName: op.displayName };
}
