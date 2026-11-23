import { z } from 'zod';
import { PLATFORM_LOCALES } from '@broker/utils/locales';

export const registerSchema = z.object({
  firstName: z.string().min(2, 'tooShort').max(60, 'tooLong'),
  lastName: z.string().min(2, 'tooShort').max(60, 'tooLong'),
  email: z.string().email('invalidEmail'),
  phone: z.string().min(10, 'invalidPhone').max(20, 'invalidPhone'),
  country: z.string().min(2, 'required'),
  accountType: z
    .string()
    .regex(/^[a-z0-9_-]{1,64}$/, 'required')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  password: z.string().min(8, 'passwordTooShort').max(200, 'tooLong'),
  locale: z.enum(PLATFORM_LOCALES),
  website: z.string().max(0, 'bot').optional().or(z.literal('')),
  consent: z.literal('on', { errorMap: () => ({ message: 'consentRequired' }) }),
  consentShown: z.string().max(400).optional(),
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
  locale: z.enum(PLATFORM_LOCALES),
});
