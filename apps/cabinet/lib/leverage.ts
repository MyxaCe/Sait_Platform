import { readTerminalLeverage, type Queryable } from '@broker/money';
import { getPool } from './db';

export async function terminalLeverageFor(userId: string): Promise<number | null> {
  const m = await readTerminalLeverage(getPool() as unknown as Queryable, [userId]);
  return m.get(userId) ?? null;
}
