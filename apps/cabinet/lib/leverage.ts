import { readTerminalLeverageTables, type Queryable, type TerminalLeverage } from '@broker/money';
import { getPool } from './db';

export async function terminalLeverageFor(userId: string): Promise<TerminalLeverage | null> {
  const m = await readTerminalLeverageTables(getPool() as unknown as Queryable, [userId]);
  return m.get(userId) ?? null;
}
