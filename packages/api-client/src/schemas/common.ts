import { z } from 'zod';

export const localeSchema = z.enum(['ru', 'en']);
export type Locale = z.infer<typeof localeSchema>;

/**
 * Медиа-объект из CRM. width/height/alt ОБЯЗАТЕЛЬНЫ:
 * это контрактная защита от CLS и провалов a11y (риск R-05).
 */
export const mediaSchema = z.object({
  url: z.string().url(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  alt: z.string(),
  mimeType: z.string(),
});
export type Media = z.infer<typeof mediaSchema>;

export const isoDateTimeSchema = z.string().datetime({ offset: true }).or(z.string().datetime());

export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected #rrggbb');
