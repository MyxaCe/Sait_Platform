import type { Article, ContentLocale, Media, RichText, VideoRef } from '@broker/api-client';
import { getCms, isDraft } from './cms';

export const ARTICLES_REVALIDATE = 60;
const NEWS_PAGE_SIZE = '50';
const EDUCATION_PAGE_SIZE = '100';

export type ArticleLevel = 'beginner' | 'intermediate' | 'advanced';

export const LEVEL_LABEL_KEY = {
  beginner: 'levelBeginner',
  intermediate: 'levelIntermediate',
  advanced: 'levelAdvanced',
} as const satisfies Record<ArticleLevel, string>;

export const LEVEL_BADGE_CLASS: Record<ArticleLevel, string> = {
  beginner: 'rounded-full bg-positive/10 px-2.5 py-1 text-positive',
  intermediate: 'rounded-full bg-accent/10 px-2.5 py-1 text-accent',
  advanced: 'rounded-full border border-accent/40 px-2.5 py-1 text-accent',
};

export interface EducationArticle {
  slug: string;
  title: string;
  excerpt: string;
  level: ArticleLevel;
  readingMinutes: number;
  bodyMarkdown: string;
  body?: RichText;
  cover?: Media;
  video?: VideoRef;
  publishedAt?: string;
}

export function isPublishedBy(publishedAt: string | undefined, now: Date): boolean {
  if (!publishedAt) return true;
  const time = Date.parse(publishedAt);
  return Number.isNaN(time) || time <= now.getTime();
}

export function visibleArticles<T extends { publishedAt?: string }>(items: T[], draft: boolean, now = new Date()): T[] {
  return draft ? items : items.filter((item) => isPublishedBy(item.publishedAt, now));
}

export async function loadNews(locale: ContentLocale): Promise<Article[]> {
  const { items } = await getCms('articles', {
    locale,
    revalidate: ARTICLES_REVALIDATE,
    params: { pageSize: NEWS_PAGE_SIZE },
  });
  return visibleArticles(
    items.filter((a) => a.section !== 'education'),
    isDraft(),
  );
}

export async function findNews(locale: ContentLocale, slug: string): Promise<Article | null> {
  return (await loadNews(locale)).find((a) => a.slug === slug) ?? null;
}

function fromCollection(article: Article): EducationArticle {
  return {
    slug: article.slug,
    title: article.title,
    excerpt: article.excerpt,
    level: article.level ?? 'beginner',
    readingMinutes: article.readingMinutes,
    bodyMarkdown: article.bodyMarkdown,
    body: article.body,
    cover: article.cover,
    video: article.video,
    publishedAt: article.publishedAt,
  };
}

export async function loadEducationArticles(locale: ContentLocale): Promise<EducationArticle[]> {
  const list = await getCms('articles', {
    locale,
    revalidate: ARTICLES_REVALIDATE,
    params: { section: 'education', pageSize: EDUCATION_PAGE_SIZE },
  });
  if (list.section === 'education') {
    return visibleArticles(list.items.map(fromCollection), isDraft());
  }
  const { articles } = await getCms('academy', { locale, revalidate: ARTICLES_REVALIDATE });
  return articles;
}

export async function findEducationArticle(locale: ContentLocale, slug: string): Promise<EducationArticle | null> {
  return (await loadEducationArticles(locale)).find((a) => a.slug === slug) ?? null;
}
