import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  buildLeadSubmittedEnvelope,
  LEAD_SUBMITTED_ROUTING_KEY,
  type LeadSubmittedData,
} from '@broker/api-client';

/**
 * Хранилище лидов (ADR-018): сайт — source of truth, клиент никогда
 * не ждёт CRM. Лид + событие пишутся В ОДНОЙ транзакции (transactional
 * outbox); релей (apps/relay) публикует события в шину платформы.
 *
 * Без DATABASE_URL (локальный dev/e2e без Docker) работает MemoryLeadStore —
 * то же поведение, события уходят в лог.
 */

export type LeadDraft = Omit<Extract<LeadSubmittedData, { kind: 'account-opening' }>, 'leadId'>
  | Omit<Extract<LeadSubmittedData, { kind: 'contact' }>, 'leadId'>;

export type CreateLeadResult =
  | { ok: true; leadId: string }
  | { ok: false; reason: 'duplicate' };

export interface LeadStore {
  createLead(draft: LeadDraft): Promise<CreateLeadResult>;
}

const PG_UNIQUE_VIOLATION = '23505';

class PgLeadStore implements LeadStore {
  constructor(private readonly pool: Pool) {}

  async createLead(draft: LeadDraft): Promise<CreateLeadResult> {
    const leadId = randomUUID();
    const occurredAt = new Date().toISOString();
    const data = { ...draft, leadId } as LeadSubmittedData;
    const envelope = buildLeadSubmittedEnvelope(randomUUID(), occurredAt, data);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO leads (id, kind, email, locale, payload) VALUES ($1, $2, $3, $4, $5)`,
        [leadId, draft.kind, draft.email, draft.locale, JSON.stringify(data)],
      );
      await client.query(
        `INSERT INTO outbox (event_id, routing_key, payload, occurred_at) VALUES ($1, $2, $3, $4)`,
        [envelope.event_id, LEAD_SUBMITTED_ROUTING_KEY, JSON.stringify(envelope), occurredAt],
      );
      await client.query('COMMIT');
      return { ok: true, leadId };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if ((error as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        return { ok: false, reason: 'duplicate' };
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

/** Dev/e2e-фолбэк без Postgres: та же семантика, события — в лог. */
export class MemoryLeadStore implements LeadStore {
  private readonly accountEmails = new Set<string>();

  async createLead(draft: LeadDraft): Promise<CreateLeadResult> {
    if (draft.kind === 'account-opening') {
      const key = draft.email.toLowerCase();
      if (this.accountEmails.has(key)) return { ok: false, reason: 'duplicate' };
      this.accountEmails.add(key);
    }
    const leadId = randomUUID();
    const envelope = buildLeadSubmittedEnvelope(
      randomUUID(),
      new Date().toISOString(),
      { ...draft, leadId } as LeadSubmittedData,
    );
    console.info('[MemoryLeadStore] outbox event (no DATABASE_URL):', JSON.stringify(envelope));
    return { ok: true, leadId };
  }
}

/* Singleton c переживанием hot-reload в dev */
const globalStore = globalThis as unknown as { __leadStore?: LeadStore; __pgPool?: Pool };

export function getLeadStore(): LeadStore {
  if (globalStore.__leadStore) return globalStore.__leadStore;

  const url = process.env.DATABASE_URL;
  if (url) {
    globalStore.__pgPool ??= new Pool({ connectionString: url, max: 5 });
    globalStore.__leadStore = new PgLeadStore(globalStore.__pgPool);
  } else {
    console.warn('[leads] DATABASE_URL not set — using in-memory store (dev only)');
    globalStore.__leadStore = new MemoryLeadStore();
  }
  return globalStore.__leadStore;
}
