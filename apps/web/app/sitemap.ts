import type { MetadataRoute } from 'next';
import type { ContentLocale } from '@broker/api-client';
import { listInstrumentPages, type InstrumentPageRef } from '@/features/instruments/instrument-detail';
import { getCms } from '@/lib/cms';
import { getMdsCatalogEntries } from '@/lib/mds';
import { getTenantAccess } from '@/lib/tenant';
import { localizedPath } from '@broker/utils/locales';
import { getSiteLanguages } from '@/lib/site-languages';
import { SITE_URL } from '@/lib/site';
import { REGULATION_PATH } from '@/features/legal/regulation';

export const dynamic = 'force-dynamic';

async function siteInstrumentPages(locale: ContentLocale): Promise<InstrumentPageRef[]> {
  try {
    const [{ items }, access, catalog] = await Promise.all([
      getCms('instruments', { locale }),
      getTenantAccess(),
      getMdsCatalogEntries(),
    ]);
    return listInstrumentPages({ cmsItems: items, access, catalog });
  } catch (error) {
    console.error(`[sitemap] инструменты не попали в карту: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const site = await getSiteLanguages();
  const locale = site.defaultLanguage;

  const [articles, academy, legal, instrumentPages, brand] = await Promise.all([
    getCms('articles', { locale, revalidate: 60, params: { pageSize: '50' } }),
    getCms('academy', { locale }),
    getCms('legal', { locale }),
    siteInstrumentPages(locale),
    getCms('brand', { locale }),
  ]);

  const staticRoutes: MetadataRoute.Sitemap = [
    { path: '', priority: 1, changeFrequency: 'daily' as const },
    { path: '/instruments', priority: 0.9, changeFrequency: 'hourly' as const },
    { path: '/accounts', priority: 0.9, changeFrequency: 'monthly' as const },
    { path: '/register', priority: 0.9, changeFrequency: 'monthly' as const },
    { path: '/analytics/news', priority: 0.8, changeFrequency: 'hourly' as const },
    { path: '/education/articles', priority: 0.7, changeFrequency: 'weekly' as const },
    { path: '/education/webinars', priority: 0.7, changeFrequency: 'daily' as const },
    { path: '/education/glossary', priority: 0.5, changeFrequency: 'monthly' as const },
    { path: '/education/faq', priority: 0.6, changeFrequency: 'monthly' as const },
    { path: '/about', priority: 0.7, changeFrequency: 'monthly' as const },
    { path: '/company/contacts', priority: 0.6, changeFrequency: 'monthly' as const },
    { path: '/partners', priority: 0.7, changeFrequency: 'monthly' as const },
    { path: '/promotions', priority: 0.7, changeFrequency: 'weekly' as const },
    { path: '/company/careers', priority: 0.5, changeFrequency: 'weekly' as const },
    ...(brand.legalEntity
      ? [{ path: REGULATION_PATH, priority: 0.4, changeFrequency: 'monthly' as const }]
      : []),
  ].map((r) => ({
    url: `${SITE_URL}${r.path}`,
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));

  const instruments: MetadataRoute.Sitemap = instrumentPages.map((d) => ({
    url: `${SITE_URL}/instruments/${d.category}/${d.symbol.toLowerCase()}`,
    lastModified: now,
    changeFrequency: 'hourly',
    priority: 0.6,
  }));

  const news: MetadataRoute.Sitemap = articles.items.map((a) => ({
    url: `${SITE_URL}/analytics/news/${a.slug}`,
    lastModified: new Date(a.publishedAt),
    changeFrequency: 'weekly',
    priority: 0.7,
  }));

  const education: MetadataRoute.Sitemap = academy.articles.map((a) => ({
    url: `${SITE_URL}/education/articles/${a.slug}`,
    lastModified: now,
    changeFrequency: 'monthly',
    priority: 0.6,
  }));

  const legalDocs: MetadataRoute.Sitemap = legal.items.map((d) => {
    const updated = new Date(d.updatedAt);
    return {
      url: `${SITE_URL}/legal/${d.slug}`,
      lastModified: Number.isNaN(updated.getTime()) ? now : updated,
      changeFrequency: 'yearly',
      priority: 0.3,
    };
  });

  const withAlternates = (entry: MetadataRoute.Sitemap[number]): MetadataRoute.Sitemap[number] => {
    if (site.languages.length < 2) return entry;
    const path = entry.url.slice(SITE_URL.length) || '/';
    return {
      ...entry,
      alternates: {
        languages: Object.fromEntries(
          site.languages.map((l) => [l, `${SITE_URL}${localizedPath(path, l, site.defaultLanguage)}`]),
        ),
      },
    };
  };

  return [...staticRoutes, ...instruments, ...news, ...education, ...legalDocs].map(withAlternates);
}
