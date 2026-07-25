import { z } from 'zod';

/** Zod-сообщения — ключи namespace `validation` (ADR-011), перевод на рендере. */

export const registerSchema = z.object({
  firstName: z.string().min(2, 'tooShort').max(60, 'tooLong'),
  lastName: z.string().min(2, 'tooShort').max(60, 'tooLong'),
  email: z.string().email('invalidEmail'),
  phone: z.string().min(10, 'invalidPhone').max(20, 'invalidPhone'),
  country: z.string().min(2, 'required'),
  accountType: z.enum(['standard', 'pro', 'ecn']),
  password: z.string().min(8, 'passwordTooShort').max(200, 'tooLong'),
  locale: z.enum(['ru', 'en']),
  /** honeypot: заполнено — бот */
  website: z.string().max(0, 'bot').optional().or(z.literal('')),
});

export const loginSchema = z.object({
  email: z.string().email('invalidEmail'),
  password: z.string().min(1, 'required'),
  website: z.string().max(0, 'bot').optional().or(z.literal('')),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'required'),
    newPassword: z.string().min(8, 'passwordTooShort').max(200, 'tooLong'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'passwordsMismatch',
    path: ['confirmPassword'],
  });

export const profileSchema = z.object({
  fullName: z.string().min(2, 'tooShort').max(120, 'tooLong'),
  locale: z.enum(['ru', 'en']),
});
