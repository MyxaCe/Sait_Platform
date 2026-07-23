/**
 * Mock-CRM (этап 0 интеграции): реализует CMS-контракт поверх текущих
 * data-файлов сайта. Каждый билдер прогоняет ответ через Zod-схему
 * контракта — mock по построению не может отдать невалидные данные.
 * При подключении реальной CRM эти данные становятся фикстурами-фолбэком.
 */
import {
  CMS_RESPONSE_SCHEMAS,
  type Locale,
} from '@broker/api-client';
import { SYMBOL_UNIVERSE } from '@broker/realtime';
import { getNewsArticles, findArticle } from '@/features/analytics/news-data';
import { ACCOUNT_PRICING, getAccountPlans } from '@/features/accounts/plans';
import { getEducationArticles } from '@/features/education/articles-data';
import { getFaqSections } from '@/features/education/faq-data';
import { getGlossaryTerms } from '@/features/education/glossary-data';
import { getWebinars } from '@/features/education/webinars-data';
import { getLegalDocuments } from '@/features/legal/documents';
import { SITE_NAME, SITE_URL } from '@/lib/site';
import enMessages from '@/messages/en.json';
import ruMessages from '@/messages/ru.json';

interface MockMessages {
  nav: Record<string, string>;
  footer: {
    columns: { title: string; links: { href: string; label: string }[] }[];
    riskWarning: string;
  };
  promotions: {
    promos: {
      badge: string;
      title: string;
      description: string;
      terms: string;
      ctaLabel: string;
      href: string;
      featured?: boolean;
    }[];
  };
  partners: {
    models: { name: string; description: string; features: string[] }[];
    tiers: { name: string; clients: string; share: string; featured?: boolean }[];
    steps: { title: string; text: string }[];
  };
  contacts: {
    channels: { title: string; value: string; detail: string }[];
    officesList: { city: string; country: string; address: string }[];
  };
  careers: {
    benefits: { title: string; text: string }[];
    vacancies: { title: string; department: string; location: string; type: string }[];
  };
  status: {
    wsName: string;
    wsDescription: string;
    services: { name: string; description: string; uptime: string }[];
    incidents: { date: string; title: string; status: string; text: string }[];
  };
}

const messages = (locale: Locale): MockMessages =>
  (locale === 'en' ? enMessages : ruMessages) as unknown as MockMessages;

const NAV_HREFS: Record<string, string> = {
  instruments: '/instruments',
  accounts: '/accounts',
  analytics: '/analytics/news',
  education: '/education',
  about: '/about',
};

const SPREAD_FROM: Record<string, { ru: string; en: string }> = {
  forex: { ru: '0.0 пунктов', en: '0.0 pips' },
  metals: { ru: '0.1 пункта', en: '0.1 pips' },
  crypto: { ru: '0.15%', en: '0.15%' },
  indices: { ru: '0.4 пункта', en: '0.4 pips' },
  stocks: { ru: '0.02%', en: '0.02%' },
  energy: { ru: '0.03', en: '0.03' },
};

export type MockBuilder = (locale: Locale, params: URLSearchParams) => unknown;

export const CMS_MOCK: Record<string, MockBuilder> = {
  brand: (locale) =>
    CMS_RESPONSE_SCHEMAS.brand.parse({
      name: SITE_NAME,
      logo: null,
      favicon: {
        url: `${SITE_URL}/icons/icon-512.png`,
        width: 512,
        height: 512,
        alt: SITE_NAME,
        mimeType: 'image/png',
      },
      primaryColor: '#d4a437',
      socials: [
        { name: 'telegram', url: 'https://t.me/apexcapital' },
        { name: 'youtube', url: 'https://www.youtube.com/@apexcapital' },
      ],
    }),

  navigation: (locale) => {
    const m = messages(locale);
    return CMS_RESPONSE_SCHEMAS.navigation.parse({
      header: Object.entries(NAV_HREFS).map(([key, href]) => ({
        label: m.nav[key],
        href,
      })),
      footer: {
        columns: m.footer.columns.map((c) => ({
          title: c.title,
          links: c.links.map((l) => ({ label: l.label, href: l.href })),
        })),
        riskWarning: m.footer.riskWarning,
      },
    });
  },

  instruments: (locale) =>
    CMS_RESPONSE_SCHEMAS.instruments.parse({
      items: SYMBOL_UNIVERSE.map((d) => ({
        symbol: d.symbol,
        name: d.name,
        category: d.category,
        digits: d.digits,
        leverageMax: '1:500',
        spreadFrom: SPREAD_FROM[d.category]?.[locale] ?? '—',
        swapFree: true,
        icon: null,
      })),
    }),

  accounts: (locale) =>
    CMS_RESPONSE_SCHEMAS.accounts.parse({
      items: getAccountPlans(locale).map((plan) => {
        const pricing = ACCOUNT_PRICING.find((p) => p.id === plan.id);
        return {
          id: plan.id,
          name: plan.name,
          description: plan.description ?? '',
          minDeposit: plan.minDeposit,
          featured: plan.featured ?? false,
          features: plan.features,
          pricing: {
            spreadPips: pricing?.spreadPips ?? 0,
            commissionPerLotRT: pricing?.commissionPerLotRT ?? 0,
          },
        };
      }),
    }),

  faq: (locale) => CMS_RESPONSE_SCHEMAS.faq.parse({ sections: getFaqSections(locale) }),

  promotions: (locale) =>
    CMS_RESPONSE_SCHEMAS.promotions.parse({
      items: messages(locale).promotions.promos.map((p, i) => ({
        id: `promo-${i + 1}`,
        badge: p.badge,
        title: p.title,
        description: p.description,
        terms: p.terms,
        ctaLabel: p.ctaLabel,
        ctaHref: p.href,
        featured: p.featured ?? false,
        activeFrom: null,
        activeTo: null,
      })),
    }),

  partners: (locale) => {
    const m = messages(locale).partners;
    return CMS_RESPONSE_SCHEMAS.partners.parse({
      models: m.models,
      tiers: m.tiers,
      steps: m.steps,
    });
  },

  academy: (locale) =>
    CMS_RESPONSE_SCHEMAS.academy.parse({
      articles: getEducationArticles(locale).map((a) => ({
        slug: a.slug,
        title: a.title,
        excerpt: a.excerpt,
        level: a.level,
        readingMinutes: a.readingMinutes,
        bodyMarkdown: a.body.join('\n\n'),
      })),
      webinars: getWebinars(new Date(), locale).map((w) => ({
        id: w.id,
        title: w.title,
        speaker: w.speaker,
        speakerRole: w.speakerRole,
        startsAt: w.datetime,
        durationMinutes: w.durationMinutes,
        level: w.level,
        description: w.description,
      })),
      glossary: getGlossaryTerms(locale),
    }),

  streams: (locale, params) => {
    const all = [
      {
        provider: 'youtube' as const,
        videoId: 'mock-live-review',
        title: locale === 'en' ? 'Weekly market review — live' : 'Еженедельный разбор рынка — эфир',
        poster: null,
        startsAt: '2026-08-05T18:00:00Z',
        status: 'upcoming' as const,
      },
      {
        provider: 'youtube' as const,
        videoId: 'mock-gold-breakdown',
        title: locale === 'en' ? 'Gold technical breakdown' : 'Технический разбор золота',
        poster: null,
        startsAt: '2026-07-10T18:00:00Z',
        status: 'past' as const,
      },
    ];
    const status = params.get('status');
    return CMS_RESPONSE_SCHEMAS.streams.parse({
      items: status ? all.filter((s) => s.status === status) : all,
    });
  },

  articles: (locale, params) => {
    const category = params.get('category');
    const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
    const pageSize = Math.min(50, Math.max(1, Number(params.get('pageSize') ?? '20') || 20));
    const all = getNewsArticles(locale)
      .filter((a) => !category || a.category === category)
      .map((a) => ({
        slug: a.slug,
        title: a.title,
        excerpt: a.excerpt,
        category: a.category,
        source: a.source,
        publishedAt: a.publishedAt,
        readingMinutes: a.readingMinutes,
        bodyMarkdown: a.body.join('\n\n'),
      }));
    return CMS_RESPONSE_SCHEMAS.articles.parse({
      items: all.slice((page - 1) * pageSize, page * pageSize),
      total: all.length,
      page,
      pageSize,
    });
  },

  contacts: (locale) => {
    const m = messages(locale).contacts;
    return CMS_RESPONSE_SCHEMAS.contacts.parse({
      channels: m.channels,
      offices: m.officesList,
    });
  },

  careers: (locale) => {
    const m = messages(locale).careers;
    return CMS_RESPONSE_SCHEMAS.careers.parse({
      benefits: m.benefits,
      vacancies: m.vacancies.map((v) => ({ ...v, applyEmail: 'hr@apexcapital.example' })),
    });
  },

  legal: (locale, params) => {
    const type = params.get('type');
    const items = getLegalDocuments(locale)
      .filter((d) => !type || d.slug === type)
      .map((d) => ({
        slug: d.slug,
        title: d.title,
        updatedAt: d.updatedAt,
        intro: d.intro,
        sections: d.sections.map((s) => ({
          heading: s.heading,
          paragraphsMarkdown: s.paragraphs,
        })),
      }));
    return CMS_RESPONSE_SCHEMAS.legal.parse({ items });
  },

  'system-status': (locale) => {
    const m = messages(locale).status;
    return CMS_RESPONSE_SCHEMAS['system-status'].parse({
      services: [
        ...m.services.slice(0, 2).map((s, i) => ({
          id: `svc-${i}`,
          name: s.name,
          description: s.description,
          status: 'operational' as const,
          uptime90d: s.uptime,
        })),
        {
          id: 'quotes-ws',
          name: m.wsName,
          description: m.wsDescription,
          status: 'operational' as const,
          uptime90d: '99.98%',
        },
        ...m.services.slice(2).map((s, i) => ({
          id: `svc-${i + 2}`,
          name: s.name,
          description: s.description,
          status: 'operational' as const,
          uptime90d: s.uptime,
        })),
      ],
      incidents: m.incidents,
    });
  },
};

/** Детальная статья: /api/cms/articles/{slug} */
export function buildArticleDetail(slug: string, locale: Locale): unknown | null {
  const article = findArticle(slug, locale);
  if (!article) return null;
  return CMS_RESPONSE_SCHEMAS.article.parse({
    slug: article.slug,
    title: article.title,
    excerpt: article.excerpt,
    category: article.category,
    source: article.source,
    publishedAt: article.publishedAt,
    readingMinutes: article.readingMinutes,
    bodyMarkdown: article.body.join('\n\n'),
  });
}
