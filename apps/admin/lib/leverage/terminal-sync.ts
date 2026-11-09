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

/**
 * ДОСТАВКА ПЛЕЧА В ТЕРМИНАЛ из решений зоны «Риск/плечо» (Р-446).
 *
 * Без неё смена портфеля/override в админке на торговлю не влияла: терминал
 * держал одно плечо на площадку (`PLATFORM_LEVERAGE`). Теперь каждое решение,
 * меняющее ДЕЙСТВУЮЩЕЕ плечо клиента, внутри своей транзакции:
 *
 *   1. читает действующее плечо затронутых клиентов ДО правки;
 *   2. правит свои таблицы;
 *   3. читает ПОСЛЕ (та же транзакция видит свою правку) — закон один,
 *      `resolveLeverage` из `@broker/money`, тот же, что у кабинета в SSO;
 *   4. пишет запись журнала (в payload — что именно поедет в терминал);
 *   5. зовёт терминал `POST …/{demo|real}/leverage` по каждому изменившемуся
 *      клиенту, со ссылкой на запись журнала;
 *   6. терминал отказал / не ответил → ROLLBACK всего (правка и журнал),
 *      применённое в терминале откатывается, оператор видит ошибку.
 *
 * Fail-closed, как у заморозки (`lib/crypto/flags.ts`). Если COMMIT упадёт
 * после успешного вызова — терминал впереди сайта; повтор той же формы
 * догонит (назначение плеча идемпотентно), а вход клиента всё равно
 * синхронизирует плечо claim-ом SSO.
 *
 * Зависимости — одним объектом, чтобы тесты подставляли и чтение, и терминал.
 */
export interface LeverageTerminalSync {
  read(db: Queryable, userIds: readonly string[]): Promise<Map<string, number>>;
  usersOfPortfolio(db: Queryable, portfolioKey: string): Promise<string[]>;
  terminal: TerminalLeverageClient;
}

export function terminalLeverageSync(): LeverageTerminalSync {
  return { read: readTerminalLeverage, usersOfPortfolio: clientsOfPortfolio, terminal: terminalMoney() };
}

/** Чем закончилась доставка — в форме исхода экшена. */
export type TerminalSyncFailure =
  | { ok: false; reason: 'terminalUnavailable' }
  | { ok: false; reason: 'terminalRefused'; code: string };

/** Сводка для payload журнала: кто, с какого на какое. */
export function changesForJournal(changes: readonly LeverageChange[]) {
  return changes.map((c) => ({ userId: c.userId, before: c.before, after: c.after }));
}

/**
 * Довезти изменения; `null` — всё применено (или применять нечего).
 * Ссылка на запись журнала уезжает в терминал `external_ref` — в журнале
 * терминала видно, каким решением сайта сменилось плечо.
 */
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
