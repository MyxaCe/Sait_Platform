import type { PoolLike } from '@broker/money';
import { asSupportRole, supportAccess, type Actor } from '@broker/support';
import { getOperatorSession } from '../auth/current';
import { getPool } from '../db';

export function supportPool(): PoolLike {
  return getPool() as unknown as PoolLike;
}

export async function supportActor(): Promise<Actor | null> {
  const op = await getOperatorSession();
  if (!op) return null;
  const role = asSupportRole(op.role);
  if (!supportAccess.worksTickets(role)) return null;
  return { operatorId: op.operatorId, role: role!, displayName: op.displayName };
}
