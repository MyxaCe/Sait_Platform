import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createWebFormTicketTx, loadSupportSettings } from '@broker/support';
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
  | { ok: true; leadId: string; ticketNumber?: number }
  | { ok: false; reason: 'duplicate' | 'channelDisabled' };

export interface LeadStore {
  createLead(draft: LeadDraft): Promise<CreateLeadResult>;
}

const PG_UNIQUE_VIOLATION = '23505';

export class PgLeadStore implements LeadStore {
  constructor(private readonly pool: Pool) {}

  async createLead(draft: LeadDraft): Promise<CreateLeadResult> {
    const leadId = randomUUID();
    const occurredAt = new Date().toISOString();
    const data = { ...draft, leadId } as LeadSubmittedData;
    const envelope = buildLeadSubmittedEnvelope(randomUUID(), occurredAt, data);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Поддержка (10.11): обращение с формы контактов — сразу тикет `web_form`
      // в той же транзакции, что лид и событие. Раньше событие `lead.submitted`
      // уходило в шину без единой привязки, и обращения не видел никто.
      const settings = draft.kind === 'contact' ? await loadSupportSettings(client) : null;
      if (settings && !settings.channels.webForm) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'channelDisabled' };
      }
      await client.query(
        `INSERT INTO leads (id, kind, email, locale, payload) VALUES ($1, $2, $3, $4, $5)`,
        [leadId, draft.kind, draft.email, draft.locale, JSON.stringify(data)],
      );
      await client.query(
        `INSERT INTO outbox (event_id, routing_key, payload, occurred_at) VALUES ($1, $2, $3, $4)`,
        [envelope.event_id, LEAD_SUBMITTED_ROUTING_KEY, JSON.stringify(envelope), occurredAt],
      );
      let ticketNumber: number | undefined;
      if (settings && draft.kind === 'contact') {
        const t = await createWebFormTicketTx(client, settings, {
          name: draft.name,
          email: draft.email,
          subject: topicSubject(draft.topic, draft.locale),
          body: draft.message,
          locale: draft.locale,
          category: TOPIC_CATEGORY[draft.topic] ?? null,
          leadId,
        });
        if (t.ok) ticketNumber = t.number;
      }
      await client.query('COMMIT');
      return { ok: true, leadId, ticketNumber };
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

/** Тема формы → тема тикета и категория поддержки (ключи категорий — из настроек по умолчанию). */
const TOPIC_SUBJECT: Record<string, { ru: string; en: string }> = {
  general: { ru: 'Общий вопрос', en: 'General question' },
  account: { ru: 'Счёт и верификация', en: 'Account and verification' },
  payments: { ru: 'Пополнение и вывод', en: 'Deposits and withdrawals' },
  partnership: { ru: 'Партнёрство', en: 'Partnership' },
};
const TOPIC_CATEGORY: Record<string, string> = { general: 'other', account: 'account', payments: 'deposit', partnership: 'other' };

function topicSubject(topic: string, locale: 'ru' | 'en'): string {
  return TOPIC_SUBJECT[topic]?.[locale] ?? topic;
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

/** Health-check БД для /api/health/ready. Без DATABASE_URL — 'skipped'. */
export async function pingDatabase(): Promise<'ok' | 'skipped' | 'failed'> {
  if (!process.env.DATABASE_URL) return 'skipped';
  try {
    globalStore.__pgPool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
    await globalStore.__pgPool.query('SELECT 1');
    return 'ok';
  } catch {
    return 'failed';
  }
}

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
