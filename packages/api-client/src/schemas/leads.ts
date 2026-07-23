import { z } from 'zod';
import { localeSchema } from './common';

/**
 * Лиды: сайт (BFF) → CRM.
 * fieldErrors в ответах — ЯЗЫКОНЕЗАВИСИМЫЕ ключи (emailExists, invalidEmail...);
 * перевод выполняет сайт.
 */

export const accountOpeningLeadSchema = z.object({
  firstName: z.string().min(2).max(60),
  lastName: z.string().min(2).max(60),
  email: z.string().email(),
  phone: z.string().min(10).max(20),
  country: z.string().min(2),
  accountType: z.enum(['standard', 'pro', 'ecn']),
  locale: localeSchema,
  source: z
    .object({
      url: z.string().url().optional(),
      promo: z.string().optional(),
      utm: z.record(z.string()).optional(),
    })
    .optional(),
});
export type AccountOpeningLead = z.infer<typeof accountOpeningLeadSchema>;

export const accountOpeningLeadResponseSchema = z.object({ leadId: z.string() });

export const contactLeadSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  topic: z.enum(['general', 'account', 'payments', 'partnership']),
  message: z.string().min(10).max(2000),
  locale: localeSchema,
});
export type ContactLead = z.infer<typeof contactLeadSchema>;

export const contactLeadResponseSchema = z.object({ ticketId: z.string() });

export const leadErrorResponseSchema = z.object({
  fieldErrors: z.record(z.string()).optional(),
  error: z.string().optional(),
});
