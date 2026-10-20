import { z } from 'zod';
import { hexColorSchema, isoDateTimeSchema, mediaSchema } from './common';

/* ------------------------------------------------------------------ */
/* GET /v1/cms/brand                                                   */
/* ------------------------------------------------------------------ */
/**
 * Бренд читается ПО ПОЛЯМ и из ОБЕИХ форм ответа (WEB-11).
 *
 * **Чем это было.** `primaryColor` допускает `null` с Р-040 — но только
 * он. Остальные поля оставались жёсткими, и жёсткость потребителя здесь
 * не строгость, а подмена данных: один негодный слот отвергал **весь**
 * ответ, `cmsFetch` уходил на фикстуру, и витрина показывала **чужое имя
 * и чужой логотип при живой CMS, без единой ошибки на странице**. Ровно
 * этот дефект команда `terminal` нашла у себя (WEB-11), и он однажды уже
 * стоил кабинету бренда целиком.
 *
 * В `public-brand.v1` обнуляем **каждый** слот картинки — `logoLight`,
 * `logoDark`, `logoMono`, `logoMark`, `favicon`, `emailLogo` — и
 * `primaryColor`. Проверять надо было против всех, а проверили против
 * одного: того, на котором обожглись.
 *
 * **Правило теперь одно: слот теряет СЕБЯ, а не весь бренд.** Негодный
 * логотип — это отсутствующий логотип (`.catch(null)`), а не отсутствующий
 * бренд. Отсутствие одного необязательного поля не доказывает отсутствия
 * остальных.
 *
 * **Что осталось жёстким и почему.** `name`. Бренд без имени нечем
 * показать, и подставлять сюда нечего: это тот случай, когда уход на
 * фикстуру — правильный исход, а не подмена.
 *
 * **Две формы ответа, а не одна.** Момент переезда контура на v2 и момент
 * нашей выкатки друг другу не подчиняются: знающий одну форму остаётся
 * без бренда либо до переезда, либо после. Поэтому читаются обе —
 * плоская legacy (`/v1/cms/brand`) и вложенная `public-brand.v1`
 * (`{contract, site, brand}`), и вторая приводится к первой. Приём взят
 * у команды `terminal` (TRM-12).
 */

/** Слот картинки: негодный слот теряет себя, а не весь бренд. */
const brandMediaSlot = mediaSchema.nullable().catch(null);

/** Цвет: негодный — значит не задан. Запасной держит потребитель. */
const brandColorSlot = hexColorSchema.nullable().catch(null);

const socialLinkSchema = z.object({ name: z.string().min(1), url: z.string().url() });

/**
 * Соцсети: негодная ссылка выбрасывается ПОШТУЧНО, а не вместе со
 * списком. Один сломанный url не повод снять со страницы остальные
 * четыре.
 */
const brandSocialsSchema = z
  .array(z.unknown())
  .transform((items) =>
    items.flatMap((item) => {
      const parsed = socialLinkSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    }),
  )
  .catch([] as z.infer<typeof socialLinkSchema>[]);

/** Плоская форма legacy: `GET /v1/cms/brand`. */
const brandLegacySchema = z.object({
  name: z.string().min(1),
  logo: brandMediaSlot,
  favicon: brandMediaSlot,
  primaryColor: brandColorSlot,
  socials: brandSocialsSchema,
});

/**
 * Вложенная форма v2: `GET /v1/sites/{slug}/brand` (`public-brand.v1`).
 *
 * Имя бренда живёт в `site.name`, основной логотип — в `brand.logoLight`.
 * Остальные слоты (`logoDark`, `logoMono`, `logoMark`, `emailLogo`) пока
 * не нужны ни витрине, ни кабинету и отбрасываются молча — так и
 * предписывает дисциплина версионирования: неизвестное/ненужное поле
 * потребитель отбрасывает и работает дальше.
 */
const brandV2Schema = z
  .object({
    contract: z.literal('v1'),
    site: z.object({ name: z.string().min(1) }),
    brand: z.object({
      logoLight: brandMediaSlot,
      favicon: brandMediaSlot,
      primaryColor: brandColorSlot,
      socials: brandSocialsSchema,
    }),
  })
  .transform((response) => ({
    name: response.site.name,
    logo: response.brand.logoLight,
    favicon: response.brand.favicon,
    primaryColor: response.brand.primaryColor,
    socials: response.brand.socials,
  }));

/**
 * Порядок ветвей значим: v2 опознаётся по `contract` и проверяется
 * первой. Плоская форма стоит второй, потому что она шире и приняла бы
 * вложенный ответ как «бренд без полей» — то есть молча отдала бы бренд
 * без имени.
 */
export const brandSchema = z.union([brandV2Schema, brandLegacySchema]);
export type Brand = z.infer<typeof brandSchema>;

/* ------------------------------------------------------------------ */
/* GET /v1/cms/navigation                                              */
/* ------------------------------------------------------------------ */
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

/* ------------------------------------------------------------------ */
/* GET /v1/cms/instruments — allow-list для WS-подписок                */
/* ------------------------------------------------------------------ */
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
  leverageMax: z.string(),
  spreadFrom: z.string(),
  swapFree: z.boolean(),
  icon: mediaSchema.nullable(),
});
export const instrumentsResponseSchema = z.object({ items: z.array(instrumentSchema) });
export type Instrument = z.infer<typeof instrumentSchema>;

/* ------------------------------------------------------------------ */
/* GET /v1/cms/accounts                                                */
/* ------------------------------------------------------------------ */
export const accountPlanSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  minDeposit: z.string(),
  featured: z.boolean(),
  features: z.array(z.object({ label: z.string(), value: z.string() })),
  pricing: z.object({
    spreadPips: z.number().nonnegative(),
    commissionPerLotRT: z.number().nonnegative(),
  }),
});
export const accountsResponseSchema = z.object({ items: z.array(accountPlanSchema) });
export type AccountPlanDto = z.infer<typeof accountPlanSchema>;

/* ------------------------------------------------------------------ */
/* GET /v1/cms/faq                                                     */
/* ------------------------------------------------------------------ */
export const faqResponseSchema = z.object({
  sections: z.array(
    z.object({
      title: z.string(),
      items: z.array(z.object({ question: z.string(), answer: z.string() })),
    }),
  ),
});
export type FaqResponse = z.infer<typeof faqResponseSchema>;

/* ------------------------------------------------------------------ */
/* GET /v1/cms/promotions                                              */
/* ------------------------------------------------------------------ */
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
});
export const promotionsResponseSchema = z.object({ items: z.array(promotionSchema) });

/* ------------------------------------------------------------------ */
/* GET /v1/cms/partners                                                */
/* ------------------------------------------------------------------ */
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

/* ------------------------------------------------------------------ */
/* GET /v1/cms/academy — обучение: статьи + вебинары + глоссарий       */
/* ------------------------------------------------------------------ */
export const academyResponseSchema = z.object({
  articles: z.array(
    z.object({
      slug: z.string(),
      title: z.string(),
      excerpt: z.string(),
      level: z.enum(['beginner', 'intermediate']),
      readingMinutes: z.number().int().positive(),
      bodyMarkdown: z.string(),
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
    }),
  ),
  glossary: z.array(z.object({ term: z.string(), definition: z.string() })),
});

/* ------------------------------------------------------------------ */
/* GET /v1/cms/streams?status=                                         */
/* ------------------------------------------------------------------ */
export const streamSchema = z.object({
  provider: z.enum(['youtube', 'vimeo']),
  videoId: z.string().min(1),
  title: z.string(),
  poster: mediaSchema.nullable(),
  startsAt: isoDateTimeSchema,
  status: z.enum(['live', 'upcoming', 'past']),
});
export const streamsResponseSchema = z.object({ items: z.array(streamSchema) });

/* ------------------------------------------------------------------ */
/* GET /v1/cms/articles (новости/пресс-центр)                          */
/* ------------------------------------------------------------------ */
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

/* ------------------------------------------------------------------ */
/* GET /v1/cms/contacts                                                */
/* ------------------------------------------------------------------ */
export const contactsResponseSchema = z.object({
  channels: z.array(z.object({ title: z.string(), value: z.string(), detail: z.string() })),
  offices: z.array(z.object({ city: z.string(), country: z.string(), address: z.string() })),
});

/* ------------------------------------------------------------------ */
/* GET /v1/cms/careers                                                 */
/* ------------------------------------------------------------------ */
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

/* ------------------------------------------------------------------ */
/* GET /v1/cms/legal                                                   */
/* ------------------------------------------------------------------ */
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

/* ------------------------------------------------------------------ */
/* GET /v1/cms/system-status                                           */
/* ------------------------------------------------------------------ */
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
