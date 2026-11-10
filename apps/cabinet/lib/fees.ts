import { readClientFees, type Fees, type Queryable } from '@broker/money';
import { getPool } from './db';

/**
 * Тариф счёта для SSO-токена (claims `markup_bps`, `commission_bps`) — тариф
 * портфеля клиента из админки (`leverage_portfolios.markup_bps/commission_bps`).
 * `null` — портфеля нет (claim не кладём, терминал держит своё).
 */
export async function terminalFeesFor(userId: string): Promise<Fees | null> {
  const m = await readClientFees(getPool() as unknown as Queryable, [userId]);
  return m.get(userId) ?? null;
}
