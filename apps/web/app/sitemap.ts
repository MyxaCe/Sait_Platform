import type { MetadataRoute } from 'next';
import { SYMBOL_UNIVERSE } from '@broker/realtime';
import { getCms } from '@/lib/cms';
import { SITE_URL } from '@/lib/site';

/**
 * Sitemap: статические разделы + страницы, чьи списки живут в CMS
 * (новости, статьи обучения, юр-документы). Прежде слаги брались из
 * data-файлов кода и расходились с CMS на первой же новой статье.
 *
 * Динамический: на сборке CMS нет (CI), а пререндер запёк бы sitemap без
 * CMS-страниц. CMS недоступна → последняя сохранённая версия её ответа
 * (`getCms`); нет и её — ошибка, а не sitemap «из ничего».
 */
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const [articles, academy, legal] = await Promise.all([
    getCms('articles', { locale: 'ru', revalidate: 60, params: { pageSize: '50' } }),
    getCms('academy', { locale: 'ru' }),
    getCms('legal', { locale: 'ru' }),
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
  ].map((r) => ({
    url: `${SITE_URL}${r.path}`,
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));

  const instruments: MetadataRoute.Sitemap = SYMBOL_UNIVERSE.map((d) => ({
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

  return [...staticRoutes, ...instruments, ...news, ...education, ...legalDocs];
}
