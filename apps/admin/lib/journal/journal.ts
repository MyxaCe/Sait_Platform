import type { PoolClient } from 'pg';
import {
  appendJournalWithinTx,
  canonicalize,
  computeEntryHash,
  type JournalEntry,
  type JournalEntryInput,
} from '@broker/money';
import { getPool, type Queryable } from '../db';

export { canonicalize, computeEntryHash, type JournalEntry, type JournalEntryInput };

type PoolLike = Queryable & { connect(): Promise<PoolClient> };

function isPoolLike(db: Queryable): db is PoolLike {
  const candidate = db as { connect?: unknown; release?: unknown };
  return typeof candidate.connect === 'function' && typeof candidate.release !== 'function';
}

export async function appendJournalEntry(
  input: JournalEntryInput,
  db: Queryable = getPool(),
): Promise<JournalEntry> {
  if (!isPoolLike(db)) {
    return appendJournalWithinTx(input, db);
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const entry = await appendJournalWithinTx(input, client as unknown as Queryable);
    await client.query('COMMIT');
    return entry;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
