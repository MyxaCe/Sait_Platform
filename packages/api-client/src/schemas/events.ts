import { z } from 'zod';
import { isoDateTimeSchema, localeSchema } from './common';

/**
 * События сайта в шину платформы (ADR-018).
 * Конверт — ПЛАТФОРМЕННЫЙ СТАНДАРТ event-envelope.v1 (финализирован 2026-07-25,
 * канон — контракт-репозиторий platform-contracts): наш исходный формат
 * + опциональные subject/correlation_id, добавленные командой CRM.
 * Доставка at-least-once → потребители дедуплицируют по event_id.
 */

export const eventEnvelopeSchema = z.object({
  event_id: z.string().uuid(),
  event: z.string().min(1), // routing key: <domain>.<event>, напр. lead.submitted
  version: z.number().int().positive(),
  occurred_at: isoDateTimeSchema,
  source: z.literal('site-web'),
  /** Опционально: идентификатор сущности события (напр. leadId) — для трейсинга */
  subject: z.string().optional(),
  /** Опционально: сквозной идентификатор цепочки событий */
  correlation_id: z.string().uuid().optional(),
  data: z.unknown(),
});
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

/* lead.submitted v1 — единственное событие маркетинговой фазы */

export const leadSubmittedAccountDataSchema = z.object({
  kind: z.literal('account-opening'),
  leadId: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().email(),
  phone: z.string(),
  country: z.string(),
  accountType: z.enum(['standard', 'pro', 'ecn']),
  locale: localeSchema,
  source: z
    .object({
      url: z.string().optional(),
      promo: z.string().optional(),
      utm: z.record(z.string()).optional(),
    })
    .optional(),
});

export const leadSubmittedContactDataSchema = z.object({
  kind: z.literal('contact'),
  leadId: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  topic: z.enum(['general', 'account', 'payments', 'partnership']),
  message: z.string(),
  locale: localeSchema,
});

export const leadSubmittedDataSchema = z.discriminatedUnion('kind', [
  leadSubmittedAccountDataSchema,
  leadSubmittedContactDataSchema,
]);
export type LeadSubmittedData = z.infer<typeof leadSubmittedDataSchema>;

export const LEAD_SUBMITTED_ROUTING_KEY = 'lead.submitted';
export const LEAD_SUBMITTED_VERSION = 1;

/** Сборка envelope для lead.submitted (используется BFF при записи в outbox) */
export function buildLeadSubmittedEnvelope(
  eventId: string,
  occurredAt: string,
  data: LeadSubmittedData,
): EventEnvelope {
  return eventEnvelopeSchema.parse({
    event_id: eventId,
    event: LEAD_SUBMITTED_ROUTING_KEY,
    version: LEAD_SUBMITTED_VERSION,
    occurred_at: occurredAt,
    source: 'site-web',
    data: leadSubmittedDataSchema.parse(data),
  });
}
