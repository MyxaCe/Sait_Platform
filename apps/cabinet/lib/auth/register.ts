import { randomUUID } from 'node:crypto';
import {
  buildLeadSubmittedEnvelope,
  LEAD_SUBMITTED_ROUTING_KEY,
  type LeadSubmittedData,
} from '@broker/api-client';
import { getPool } from '../db';
import { getTenantStartBalanceCents } from '../tenant';
import { hashPassword } from './password';

/**
 * Регистрация = открытие счёта (ADR-022, решение 3): в ОДНОЙ транзакции
 * user + lead(account-opening) + outbox lead.submitted (конверт v1 —
 * для CRM ничего не меняется) + welcome-уведомление + демо-счёт $10 000.
 */

export interface RegisterInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  country: string;
  accountType: 'standard' | 'pro' | 'ecn';
  password: string;
  locale: 'ru' | 'en';
}

export type RegisterResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'emailExists' };

const PG_UNIQUE_VIOLATION = '23505';

export async function registerUser(input: RegisterInput): Promise<RegisterResult> {
  const userId = randomUUID();
  const leadId = randomUUID();
  const occurredAt = new Date().toISOString();
  const passwordHash = await hashPassword(input.password);
  // Стартовый демо-баланс — из конфига тенанта CMS (единый источник с
  // терминалом); CMS недоступна → дефолт $10 000. Сеть ДО транзакции.
  const startBalanceCents = await getTenantStartBalanceCents();

  const leadData: LeadSubmittedData = {
    kind: 'account-opening',
    leadId,
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    phone: input.phone,
    country: input.country,
    accountType: input.accountType,
    locale: input.locale,
    source: { promo: 'cabinet-registration' },
  };
  const envelope = buildLeadSubmittedEnvelope(randomUUID(), occurredAt, leadData);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO users (id, email, password_hash, full_name, locale)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, input.email, passwordHash, `${input.firstName} ${input.lastName}`, input.locale],
    );
    await client.query(
      `INSERT INTO leads (id, kind, email, locale, payload) VALUES ($1, $2, $3, $4, $5)`,
      [leadId, 'account-opening', input.email, input.locale, JSON.stringify(leadData)],
    );
    await client.query(
      `INSERT INTO outbox (event_id, routing_key, payload, occurred_at) VALUES ($1, $2, $3, $4)`,
      [envelope.event_id, LEAD_SUBMITTED_ROUTING_KEY, JSON.stringify(envelope), occurredAt],
    );
    await client.query(`INSERT INTO demo_accounts (user_id, balance_cents) VALUES ($1, $2)`, [
      userId,
      startBalanceCents,
    ]);
    await client.query(
      `INSERT INTO notifications (id, user_id, type, params) VALUES ($1, $2, $3, $4)`,
      [randomUUID(), userId, 'welcome', JSON.stringify({ accountType: input.accountType })],
    );
    await client.query('COMMIT');
    return { ok: true, userId };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if ((error as { code?: string }).code === PG_UNIQUE_VIOLATION) {
      return { ok: false, reason: 'emailExists' };
    }
    throw error;
  } finally {
    client.release();
  }
}
