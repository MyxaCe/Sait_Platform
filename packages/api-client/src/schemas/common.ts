import { z } from 'zod';

export const localeSchema = z.enum(['ru', 'en']);
export type Locale = z.infer<typeof localeSchema>;
export const contentLocaleSchema = z.enum(['ru', 'en', 'de', 'fr', 'es']);
export type ContentLocale = z.infer<typeof contentLocaleSchema>;

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
