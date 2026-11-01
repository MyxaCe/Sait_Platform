import { computeEntryHash } from '@/lib/journal/journal';

/**
 * Проверка целостности хеш-цепочки журнала (ADM-06, Р-049).
 *
 * КРИТИЧНО: хеш каждой записи пересчитывается РОВНО тем же `computeEntryHash`
 * (а значит и `canonicalize`), которым запись создавалась в
 * `apps/admin/lib/journal/journal.ts`. Своей канонизации здесь НЕТ — иначе
 * проверка разошлась бы с записью и «рвала» бы цельную цепочку на ровном месте.
 *
 * `occurredAt` в каждой строке — это ISO-строка, восстановленная из
 * `timestamptz` ровно в формат `new Date().toISOString()` (мс + 'Z'), т.е. в
 * тот самый вид, что входил в хеш при записи (см. `queries.ts`).
 *
 * Два инварианта на каждую запись по возрастанию `seq`:
 *  1. **связь:** `prev_hash` записи равен `entry_hash` предыдущей (у первой —
 *     `null`);
 *  2. **содержимое:** `entry_hash` равен независимо пересчитанному хешу полей.
 * Любой из двух не сошёлся — цепочка разорвана на этом `seq`.
 */

/** Строка журнала с полями, достаточными для пересчёта хеша. */
export interface ChainRow {
  seq: number;
  /** ISO-строка в формате `new Date().toISOString()` (мс, 'Z'). */
  occurredAt: string;
  operatorId: string;
  action: string;
  subjectKind: string;
  subjectId: string;
  payload: Record<string, unknown>;
  prevHash: string | null;
  entryHash: string;
}

export type ChainResult =
  /** Цепочка цела: все `count` записей сошлись. */
  | { ok: true; count: number }
  /**
   * Разрыв на записи `brokenSeq`. `reason`:
   *  - `link` — `prev_hash` не равен `entry_hash` предыдущей (звено изъято/переставлено);
   *  - `hash` — `entry_hash` не сходится с содержимым (строку подменили).
   */
  | { ok: false; count: number; brokenSeq: number; reason: 'link' | 'hash' };

/**
 * Проверяет цепочку. Строки ДОЛЖНЫ идти по возрастанию `seq` (см.
 * `loadChainRows`). Останавливается на первом разрыве и называет `seq`.
 */
export function verifyChain(rows: ChainRow[]): ChainResult {
  let previousHash: string | null = null;

  for (const row of rows) {
    // 1. Связь с предыдущей записью.
    if (row.prevHash !== previousHash) {
      return { ok: false, count: rows.length, brokenSeq: row.seq, reason: 'link' };
    }

    // 2. Содержимое: пересчёт тем же computeEntryHash, что и при записи.
    const recomputed = computeEntryHash({
      prevHash: row.prevHash,
      occurredAt: row.occurredAt,
      operatorId: row.operatorId,
      action: row.action,
      subjectKind: row.subjectKind,
      subjectId: row.subjectId,
      payload: row.payload,
    });
    if (recomputed !== row.entryHash) {
      return { ok: false, count: rows.length, brokenSeq: row.seq, reason: 'hash' };
    }

    previousHash = row.entryHash;
  }

  return { ok: true, count: rows.length };
}
