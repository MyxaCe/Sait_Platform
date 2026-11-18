import { randomUUID } from 'node:crypto';
import {
  buildLeadSubmittedEnvelope,
  LEAD_SUBMITTED_ROUTING_KEY,
  type LeadSubmittedData,
} from '@broker/api-client';
import type { Queryable } from '@broker/money';
import {
  readPromoSettings,
  recordAttributionWithinTx,
  resolveAttribution,
  type ResolvedAttribution,
} from '@broker/promo';
import { bindInviteWithinTx } from '@broker/transfer';
import { getPool } from '../db';
import { getTenantStartBalance } from '../tenant';
import { hashPassword } from './password';

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

export type RegisterRefusal =
  | { ok: false; reason: 'emailExists' }
  | { ok: false; reason: 'startBalanceUnset' }
  | { ok: false; reason: 'startBalanceUnavailable'; detail: string };

export type RegisterResult = { ok: true; userId: string } | RegisterRefusal;

export interface RegisterContext {
  cookies?: { ref?: string | null; promo?: string | null };
  params?: { ref?: string | null; promo?: string | null };
  ip?: string | null;
  ipCountry?: string | null;
  now?: Date;
  invite?: string | null;
}

async function resolveRegistrationAttribution(ctx: RegisterContext): Promise<ResolvedAttribution | null> {
  const any = ctx.cookies?.ref || ctx.cookies?.promo || ctx.params?.ref || ctx.params?.promo;
  if (!any) return null;
  try {
    const settings = await readPromoSettings(getPool() as unknown as Queryable);
    if (!settings) return null;
    return resolveAttribution({
      cookies: ctx.cookies ?? {},
      params: ctx.params ?? {},
      now: ctx.now ?? new Date(),
      windowDays: settings.attributionWindowDays,
    });
  } catch (error) {
    console.error('[register] атрибуция не прочитана (настройки акций) — регистрируем без неё', error);
    return null;
  }
}

const ISO2 = /^[A-Z]{2}$/;
const iso2 = (v: string | null | undefined): string | null => {
  const c = (v ?? '').trim().toUpperCase();
  return ISO2.test(c) ? c : null;
};

const PG_UNIQUE_VIOLATION = '23505';

export async function registerUser(input: RegisterInput, ctx: RegisterContext = {}): Promise<RegisterResult> {
  const userId = randomUUID();
  const leadId = randomUUID();
  const occurredAt = new Date().toISOString();
  const startBalance = await getTenantStartBalance();
  if (startBalance.state !== 'set') {
    console.error(
      `[register] отказ: стартовый демо-баланс не назначен (${startBalance.state})`,
      { state: startBalance.state, reason: 'reason' in startBalance ? startBalance.reason : null },
    );
    return startBalance.state === 'unset'
      ? { ok: false, reason: 'startBalanceUnset' }
      : { ok: false, reason: 'startBalanceUnavailable', detail: startBalance.reason };
  }
  const passwordHash = await hashPassword(input.password);
  const attribution = await resolveRegistrationAttribution(ctx);

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
    source: { promo: attribution?.promo?.value ?? 'cabinet-registration' },
  };
  const envelope = buildLeadSubmittedEnvelope(randomUUID(), occurredAt, leadData);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO users (id, email, password_hash, full_name, locale, country, registration_ip, registration_ip_country)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        userId,
        input.email,
        passwordHash,
        `${input.firstName} ${input.lastName}`,
        input.locale,
        iso2(input.country),
        ctx.ip?.trim() || null,
        iso2(ctx.ipCountry),
      ],
    );
    await client.query(
      `INSERT INTO leads (id, kind, email, locale, payload) VALUES ($1, $2, $3, $4, $5)`,
      [leadId, 'account-opening', input.email, input.locale, JSON.stringify(leadData)],
    );
    await client.query(
      `INSERT INTO outbox (event_id, routing_key, payload, occurred_at) VALUES ($1, $2, $3, $4)`,
      [envelope.event_id, LEAD_SUBMITTED_ROUTING_KEY, JSON.stringify(envelope), occurredAt],
    );
    await client.query(
      `INSERT INTO notifications (id, user_id, type, params) VALUES ($1, $2, $3, $4)`,
      [randomUUID(), userId, 'welcome', JSON.stringify({ accountType: input.accountType })],
    );
    if (ctx.invite) {
      await bindInviteWithinTx(client as unknown as Queryable, { token: ctx.invite, userId });
    }
    if (attribution) {
      await recordAttributionWithinTx(client as unknown as Queryable, {
        refereeUserId: userId,
        refereeEmail: input.email,
        ip: ctx.ip?.trim() || null,
        resolved: attribution,
      });
    }
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
