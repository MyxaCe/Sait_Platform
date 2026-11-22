import { z } from 'zod';
import { hexColorSchema, isoDateTimeSchema, mediaSchema } from './common';

const brandMediaSlot = mediaSchema.nullable().catch(null);

const brandColorSlot = hexColorSchema.nullable().catch(null);

const heroBackgroundSlot = z.enum(['quotes', 'off']).optional().catch(undefined);

const socialLinkSchema = z.object({ name: z.string().min(1), url: z.string().url() });

const brandSocialsSchema = z
  .array(z.unknown())
  .transform((items) =>
    items.flatMap((item) => {
      const parsed = socialLinkSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    }),
  )
  .catch([] as z.infer<typeof socialLinkSchema>[]);

const brandLegacySchema = z.object({
  name: z.string().min(1),
  logo: brandMediaSlot,
  favicon: brandMediaSlot,
  primaryColor: brandColorSlot,
  socials: brandSocialsSchema,
  heroBackground: heroBackgroundSlot,
});

const brandV2Schema = z
  .object({
    contract: z.literal('v1'),
    site: z.object({ name: z.string().min(1) }),
    brand: z.object({
      logoLight: brandMediaSlot,
      favicon: brandMediaSlot,
      primaryColor: brandColorSlot,
      socials: brandSocialsSchema,
      heroBackground: heroBackgroundSlot,
    }),
  })
  .transform((response) => ({
    name: response.site.name,
    logo: response.brand.logoLight,
    favicon: response.brand.favicon,
    primaryColor: response.brand.primaryColor,
    socials: response.brand.socials,
    heroBackground: response.brand.heroBackground,
  }));

export const brandSchema = z.union([brandV2Schema, brandLegacySchema]);
export type Brand = z.infer<typeof brandSchema>;

export const navLinkSchema = z.object({
  label: z.string().min(1),
  href: z.string().min(1),
});

export const navigationSchema = z.object({
  header: z.array(navLinkSchema),
  footer: z.object({
    columns: z.array(
      z.object({ title: z.string(), links: z.array(navLinkSchema) }),
    ),
    riskWarning: z.string(),
  }),
});
export type Navigation = z.infer<typeof navigationSchema>;

export const instrumentCategorySchema = z.enum([
  'forex',
  'metals',
  'crypto',
  'indices',
  'stocks',
  'energy',
]);

export const instrumentSchema = z.object({
  symbol: z.string().min(1),
  name: z.string().min(1),
  category: instrumentCategorySchema,
  digits: z.number().int().min(0).max(8),
  leverageMax: z.string().optional(),
  spreadFrom: z.string(),
  swapFree: z.boolean(),
  icon: mediaSchema.nullable(),
});
export const instrumentsResponseSchema = z.object({ items: z.array(instrumentSchema) });
export type Instrument = z.infer<typeof instrumentSchema>;

export const accountPlanSchema = z.object({
  id: z.string(),
  portfolioKey: z.string().nullable().optional(),
  name: z.string(),
  description: z.string(),
  minDeposit: z.string().optional(),
  featured: z.boolean(),
  features: z.array(z.object({ label: z.string(), value: z.string() })),
  pricing: z
    .object({
      spreadPips: z.number().nonnegative(),
      commissionPerLotRT: z.number().nonnegative(),
    })
    .optional(),
});
export const accountsResponseSchema = z.object({ items: z.array(accountPlanSchema) });
export type AccountPlanDto = z.infer<typeof accountPlanSchema>;

export const faqResponseSchema = z.object({
  sections: z.array(
    z.object({
      title: z.string(),
      items: z.array(z.object({ question: z.string(), answer: z.string() })),
    }),
  ),
});
export type FaqResponse = z.infer<typeof faqResponseSchema>;

export const promotionSchema = z.object({
  id: z.string(),
  badge: z.string(),
  title: z.string(),
  description: z.string(),
  terms: z.string(),
  ctaLabel: z.string(),
  ctaHref: z.string(),
  featured: z.boolean(),
  activeFrom: isoDateTimeSchema.nullable(),
  activeTo: isoDateTimeSchema.nullable(),
  image: mediaSchema.nullable().optional().catch(null),
});
export const promotionsResponseSchema = z.object({ items: z.array(promotionSchema) });

export const partnersResponseSchema = z.object({
  models: z.array(
    z.object({ name: z.string(), description: z.string(), features: z.array(z.string()) }),
  ),
  tiers: z.array(
    z.object({
      name: z.string(),
      clients: z.string(),
      share: z.string(),
      featured: z.boolean().optional(),
    }),
  ),
  steps: z.array(z.object({ title: z.string(), text: z.string() })),
});

const videoProviderSchema = z.enum(['youtube', 'vimeo']);
export const videoRefSchema = z.object({
  provider: videoProviderSchema,
  videoId: z.string().min(1),
  url: z.string().url(),
});
export type VideoRef = z.infer<typeof videoRefSchema>;
const httpsUrlSchema = z.string().url().regex(/^https:\/\//);

export const academyResponseSchema = z.object({
  articles: z.array(
    z.object({
      slug: z.string(),
      title: z.string(),
      excerpt: z.string(),
      level: z.enum(['beginner', 'intermediate']),
      readingMinutes: z.number().int().positive(),
      bodyMarkdown: z.string(),
      video: videoRefSchema.optional().catch(undefined),
    }),
  ),
  webinars: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      speaker: z.string(),
      speakerRole: z.string(),
      startsAt: isoDateTimeSchema,
      durationMinutes: z.number().int().positive(),
      level: z.string(),
      description: z.string(),
      recording: videoRefSchema.optional().catch(undefined),
      joinUrl: httpsUrlSchema.optional().catch(undefined),
    }),
  ),
  glossary: z.array(z.object({ term: z.string(), definition: z.string() })),
});

export const streamSchema = z.object({
  provider: videoProviderSchema,
  videoId: z.string().min(1),
  title: z.string(),
  poster: mediaSchema.nullable(),
  startsAt: isoDateTimeSchema,
  status: z.enum(['live', 'upcoming', 'past']),
  videoUrl: z.string().url().optional().catch(undefined),
});
export const streamsResponseSchema = z.object({ items: z.array(streamSchema) });

export const articleSchema = z.object({
  slug: z.string(),
  title: z.string(),
  excerpt: z.string(),
  category: z.string(),
  source: z.string(),
  publishedAt: isoDateTimeSchema,
  readingMinutes: z.number().int().positive(),
  bodyMarkdown: z.string(),
});
export const articlesResponseSchema = z.object({
  items: z.array(articleSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type Article = z.infer<typeof articleSchema>;

export const contactsResponseSchema = z.object({
  channels: z.array(z.object({ title: z.string(), value: z.string(), detail: z.string() })),
  offices: z.array(z.object({ city: z.string(), country: z.string(), address: z.string() })),
});

export const careersResponseSchema = z.object({
  benefits: z.array(z.object({ title: z.string(), text: z.string() })),
  vacancies: z.array(
    z.object({
      title: z.string(),
      department: z.string(),
      location: z.string(),
      type: z.string(),
      applyEmail: z.string().email(),
    }),
  ),
});

export const legalDocumentSchema = z.object({
  slug: z.string(),
  title: z.string(),
  updatedAt: z.string(),
  intro: z.string(),
  sections: z.array(
    z.object({ heading: z.string(), paragraphsMarkdown: z.array(z.string()) }),
  ),
});
export const legalResponseSchema = z.object({ items: z.array(legalDocumentSchema) });

export const systemStatusResponseSchema = z.object({
  services: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      status: z.enum(['operational', 'degraded', 'outage', 'maintenance']),
      uptime90d: z.string(),
    }),
  ),
  incidents: z.array(
    z.object({ date: z.string(), title: z.string(), status: z.string(), text: z.string() }),
  ),
});
