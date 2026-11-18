import { readClientFees, type Fees, type Queryable } from '@broker/money';
import { getPool } from './db';

export async function terminalFeesFor(userId: string): Promise<Fees | null> {
  const m = await readClientFees(getPool() as unknown as Queryable, [userId]);
  return m.get(userId) ?? null;
}
