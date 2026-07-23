import { z } from 'zod';

/**
 * Схема формы обратной связи — общая для клиента и BFF-роута.
 * Сообщения — ключи из namespace `validation` (см. registration/schema.ts).
 */
export const contactSchema = z.object({
  name: z.string().trim().min(2, 'nameMin').max(80, 'nameMax'),
  email: z.string().trim().email('invalidEmail'),
  topic: z.enum(['general', 'account', 'payments', 'partnership'], {
    errorMap: () => ({ message: 'selectTopic' }),
  }),
  message: z.string().trim().min(10, 'messageMin').max(2000, 'messageMax'),
});

export type ContactInput = z.infer<typeof contactSchema>;

export const CONTACT_TOPIC_VALUES = ['general', 'account', 'payments', 'partnership'] as const;
