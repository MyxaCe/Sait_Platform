import { z } from 'zod';

/**
 * Единая схема заявки на открытие счёта.
 * Используется И на клиенте (react-hook-form), И на сервере (BFF-роут).
 * Сообщения об ошибках — КЛЮЧИ из namespace `validation` (messages/*.json):
 * клиент переводит их при отображении, поэтому валидация локализована,
 * а серверные fieldErrors остаются языконезависимыми.
 */
export const registerLeadSchema = z.object({
  firstName: z.string().trim().min(2, 'nameMin').max(60, 'nameMax'),
  lastName: z.string().trim().min(2, 'nameMin').max(60, 'nameMax'),
  email: z.string().trim().email('invalidEmail'),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9()\s-]{10,18}$/, 'phoneFormat'),
  country: z.string().min(2, 'selectCountry'),
  accountType: z.enum(['standard', 'pro', 'ecn'], {
    errorMap: () => ({ message: 'selectAccountType' }),
  }),
  agreeTerms: z.literal(true, {
    errorMap: () => ({ message: 'acceptTerms' }),
  }),
});

export type RegisterLeadInput = z.infer<typeof registerLeadSchema>;

export const ACCOUNT_TYPE_VALUES = ['standard', 'pro', 'ecn'] as const;
