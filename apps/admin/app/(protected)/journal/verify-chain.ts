import { computeEntryHash } from '@/lib/journal/journal';

export interface ChainRow {
  seq: number;
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
  | { ok: true; count: number }
  | { ok: false; count: number; brokenSeq: number; reason: 'link' | 'hash' };

export function verifyChain(rows: ChainRow[]): ChainResult {
  let previousHash: string | null = null;

  for (const row of rows) {
    if (row.prevHash !== previousHash) {
      return { ok: false, count: rows.length, brokenSeq: row.seq, reason: 'link' };
    }

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
