import type { MetadataRoute } from 'next';
import { SYMBOL_UNIVERSE } from '@broker/realtime';
import { NEWS_ARTICLES } from '@/features/analytics/news-data';
import { BLOG_POSTS } from '@/features/blog/posts-data';
import { EDUCATION_ARTICLES } from '@/features/education/articles-data';
import { LEGAL_DOCUMENTS } from '@/features/legal/documents';
import { SITE_URL } from '@/lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { path: '', priority: 1, changeFrequency: 'daily' as const },
    { path: '/instruments', priority: 0.9, changeFrequency: 'hourly' as const },
    { path: '/accounts', priority: 0.9, changeFrequency: 'monthly' as const },
    { path: '/register', priority: 0.9, changeFrequency: 'monthly' as const },
    { path: '/analytics/news', priority: 0.8, changeFrequency: 'hourly' as const },
    { path: '/analytics/calendar', priority: 0.8, changeFrequency: 'daily' as const },
    { path: '/education/articles', priority: 0.7, changeFrequency: 'weekly' as const },
    { path: '/education/webinars', priority: 0.7, changeFrequency: 'daily' as const },
    { path: '/education/glossary', priority: 0.5, changeFrequency: 'monthly' as const },
    { path: '/education/faq', priority: 0.6, changeFrequency: 'monthly' as const },
    { path: '/about', priority: 0.7, changeFrequency: 'monthly' as const },
    { path: '/company/contacts', priority: 0.6, changeFrequency: 'monthly' as const },
    { path: '/partners', priority: 0.7, changeFrequency: 'monthly' as const },
    { path: '/promotions', priority: 0.7, changeFrequency: 'weekly' as const },
    { path: '/blog', priority: 0.6, changeFrequency: 'weekly' as const },
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

  const news: MetadataRoute.Sitemap = NEWS_ARTICLES.map((a) => ({
    url: `${SITE_URL}/analytics/news/${a.slug}`,
    lastModified: new Date(a.publishedAt),
    changeFrequency: 'weekly',
    priority: 0.7,
  }));

  const education: MetadataRoute.Sitemap = EDUCATION_ARTICLES.map((a) => ({
    url: `${SITE_URL}/education/articles/${a.slug}`,
    lastModified: now,
    changeFrequency: 'monthly',
    priority: 0.6,
  }));

  const blog: MetadataRoute.Sitemap = BLOG_POSTS.map((p) => ({
    url: `${SITE_URL}/blog/${p.slug}`,
    lastModified: new Date(p.publishedAt),
    changeFrequency: 'monthly',
    priority: 0.5,
  }));

  const legal: MetadataRoute.Sitemap = LEGAL_DOCUMENTS.map((d) => ({
    url: `${SITE_URL}/legal/${d.slug}`,
    lastModified: new Date(d.updatedAt),
    changeFrequency: 'yearly',
    priority: 0.3,
  }));

  return [...staticRoutes, ...instruments, ...news, ...education, ...blog, ...legal];
}
