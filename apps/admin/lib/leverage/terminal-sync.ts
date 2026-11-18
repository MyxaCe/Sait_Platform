import {
  clientsOfPortfolio,
  leverageChanges,
  pushLeverageToTerminal,
  readTerminalLeverage,
  type LeverageChange,
  type Queryable,
  type TerminalLeverageClient,
} from '@broker/money';
import { terminalMoney } from '../crypto/runtime';

export interface LeverageTerminalSync {
  read(db: Queryable, userIds: readonly string[]): Promise<Map<string, number>>;
  usersOfPortfolio(db: Queryable, portfolioKey: string): Promise<string[]>;
  terminal: TerminalLeverageClient;
}

export function terminalLeverageSync(): LeverageTerminalSync {
  return { read: readTerminalLeverage, usersOfPortfolio: clientsOfPortfolio, terminal: terminalMoney() };
}

export type TerminalSyncFailure =
  | { ok: false; reason: 'terminalUnavailable' }
  | { ok: false; reason: 'terminalRefused'; code: string };

export function changesForJournal(changes: readonly LeverageChange[]) {
  return changes.map((c) => ({ userId: c.userId, before: c.before, after: c.after }));
}

export async function deliverToTerminal(
  sync: LeverageTerminalSync,
  changes: readonly LeverageChange[],
  meta: { reason: string; operatorLogin: string; journalSeq: number },
): Promise<TerminalSyncFailure | null> {
  if (changes.length === 0) return null;
  const out = await pushLeverageToTerminal(sync.terminal, changes, {
    reason: meta.reason,
    operator: meta.operatorLogin,
    externalRef: `adm-journal:${meta.journalSeq}`,
  });
  if (out.ok) return null;
  if (out.compensationFailed > 0) {
    console.error(
      `[leverage] откат плеча в терминале не дошёл (${out.compensationFailed} счетов): терминал впереди сайта до повтора формы или входа клиента`,
    );
  }
  return out.reason === 'terminalRefused'
    ? { ok: false, reason: 'terminalRefused', code: out.code }
    : { ok: false, reason: 'terminalUnavailable' };
}

export { leverageChanges };
