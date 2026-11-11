import {
  appendJournalSeqWithinTx,
  inTransaction,
  isMinStopBps,
  rollback,
  terminalStopsClientFromEnv,
  type PoolLike,
  type StopsOutcome,
  type TerminalStopsClient,
} from '@broker/money';
import { moneyPool } from '../crypto/runtime';

/**
 * «Минимальное расстояние стоп-лосса/тейк-профита» (б.п., 10 б.п. = 0,1 % от
 * цены). Значение ЖИВЁТ В ТЕРМИНАЛЕ (он отвергает слишком близкие SL/TP) —
 * у сайта своей копии нет, экран показывает то, что вернул терминал (GET).
 *
 * Сохранение — как заморозка в денежных флагах: одна транзакция, в ней
 * сначала вызов терминала (`PUT …/settings/stops`), затем запись журнала
 * `platform.terminal_stops.updated` (до/после, основание). Терминал отказал
 * или не ответил — откат, журнала нет, оператор видит ошибку (не делаем вид,
 * что сохранено). Повтор той же формы безопасен: PUT идемпотентен по смыслу.
 */

export type StopsResult =
  | { ok: true; minStopBps: number; journalSeq: number }
  | { ok: false; reason: 'missingReason' | 'invalidStopBps' | 'noChange' }
  /** `code` — почему недоступно (network / auth / http-error…): оператору видно, что чинить. */
  | { ok: false; reason: 'terminalUnavailable'; code: string }
  | { ok: false; reason: 'terminalRefused'; code: string };

const store = globalThis as unknown as { __adminTerminalStops?: TerminalStopsClient; __adminTerminalStopsReader?: TerminalStopsClient };

export function terminalStops(): TerminalStopsClient {
  store.__adminTerminalStops ??= terminalStopsClientFromEnv();
  return store.__adminTerminalStops;
}

/** Чтение для экрана — короткий таймаут: страница настроек не висит, если терминал лежит. */
function terminalStopsReader(): TerminalStopsClient {
  store.__adminTerminalStopsReader ??= terminalStopsClientFromEnv(process.env, 2_500);
  return store.__adminTerminalStopsReader;
}

export async function readMinStop(terminal: TerminalStopsClient = terminalStopsReader()): Promise<StopsOutcome> {
  return terminal.getMinStop().catch(() => ({ state: 'unavailable' as const, reason: 'network' as const }));
}

export async function updateMinStop(
  input: { operatorId: string; reason: string; minStopBps: number },
  pool: PoolLike = moneyPool(),
  terminal: TerminalStopsClient = terminalStops(),
): Promise<StopsResult> {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, reason: 'missingReason' };
  if (!isMinStopBps(input.minStopBps)) return { ok: false, reason: 'invalidStopBps' };

  // «До» — из терминала; не ответил — `null` (запись всё равно возможна, если PUT пройдёт).
  const current = await readMinStop(terminal);
  const before = current.state === 'ok' ? current.minStopBps : null;
  if (before === input.minStopBps) return { ok: false, reason: 'noChange' };

  return inTransaction<StopsResult>(pool, async (tx) => {
    const out = await terminal
      .setMinStop(input.minStopBps)
      .catch(() => ({ state: 'unavailable' as const, reason: 'network' as const }));
    if (out.state === 'refused') return rollback<StopsResult>({ ok: false, reason: 'terminalRefused', code: out.code });
    if (out.state === 'unavailable') return rollback<StopsResult>({ ok: false, reason: 'terminalUnavailable', code: out.reason });

    const seq = await appendJournalSeqWithinTx(
      {
        operatorId: input.operatorId,
        action: 'platform.terminal_stops.updated',
        subjectKind: 'platform',
        subjectId: 'terminal_stops',
        payload: { basis: reason, field: 'minStopBps', before, after: out.minStopBps, requested: input.minStopBps },
      },
      tx,
    );
    return { ok: true, minStopBps: out.minStopBps, journalSeq: seq };
  });
}
