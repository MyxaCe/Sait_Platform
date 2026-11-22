import { createHash } from 'node:crypto';
import type { Queryable } from './db';

export interface JournalEntryInput {
  operatorId: string;
  action: string;
  subjectKind: string;
  subjectId: string;
  payload?: Record<string, unknown>;
}

export interface JournalEntry extends Required<JournalEntryInput> {
  occurredAt: string;
  prevHash: string | null;
  entryHash: string;
}

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(',')}}`;
}

export function computeEntryHash(fields: {
  prevHash: string | null;
  occurredAt: string;
  operatorId: string;
  action: string;
  subjectKind: string;
  subjectId: string;
  payload: Record<string, unknown>;
}): string {
  const canonical = canonicalize({
    prevHash: fields.prevHash,
    occurredAt: fields.occurredAt,
    operatorId: fields.operatorId,
    action: fields.action,
    subjectKind: fields.subjectKind,
    subjectId: fields.subjectId,
    payload: fields.payload,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

const JOURNAL_LOCK_SQL = `SELECT pg_advisory_xact_lock(hashtext('admin_action_journal'))`;

export async function appendJournalWithinTx(
  input: JournalEntryInput,
  db: Queryable,
): Promise<JournalEntry> {
  await db.query(JOURNAL_LOCK_SQL);

  const payload = input.payload ?? {};
  const occurredAt = new Date().toISOString();

  const prev = await db.query(
    `SELECT entry_hash FROM admin_action_journal ORDER BY seq DESC LIMIT 1`,
  );
  const prevHash = (prev.rows[0]?.entry_hash as string | undefined) ?? null;

  const entryHash = computeEntryHash({
    prevHash,
    occurredAt,
    operatorId: input.operatorId,
    action: input.action,
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
    payload,
  });

  await db.query(
    `INSERT INTO admin_action_journal
       (occurred_at, operator_id, action, subject_kind, subject_id, payload, prev_hash, entry_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      occurredAt,
      input.operatorId,
      input.action,
      input.subjectKind,
      input.subjectId,
      JSON.stringify(payload),
      prevHash,
      entryHash,
    ],
  );

  return {
    operatorId: input.operatorId,
    action: input.action,
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
    payload,
    occurredAt,
    prevHash,
    entryHash,
  };
}

export async function appendJournalSeqWithinTx(
  input: JournalEntryInput,
  db: Queryable,
): Promise<number> {
  const entry = await appendJournalWithinTx(input, db);
  const row = await db.query(`SELECT seq FROM admin_action_journal WHERE entry_hash = $1`, [
    entry.entryHash,
  ]);
  const seq = Number((row.rows[0] as { seq?: number | string } | undefined)?.seq);
  if (!Number.isFinite(seq)) throw new Error('не удалось получить seq записи журнала');
  return seq;
}
