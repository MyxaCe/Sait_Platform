import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Badge, Button } from '@broker/ui';
import { formatDate, formatTime } from '@broker/utils';
import { Link } from '@/i18n/navigation';
import {
  findArticle,
  NEWS_CATEGORY_LABELS,
  NEWS_SLUGS,
} from '@/features/analytics/news-data';

interface PageParams {
  params: { locale: string; slug: string };
}

export function generateStaticParams() {
  return NEWS_SLUGS.map((slug) => ({ slug }));
}

export function generateMetadata({ params }: PageParams): Metadata {
  const article = findArticle(params.slug, params.locale);
  if (!article) return {};
  return {
    title: article.title,
    description: article.excerpt,
    openGraph: {
      type: 'article',
      title: article.title,
      description: article.excerpt,
      publishedTime: article.publishedAt,
    },
  };
}

export default async function NewsArticlePage({ params }: PageParams) {
  setRequestLocale(params.locale);
  const article = findArticle(params.slug, params.locale);
  if (!article) notFound();
  const t = await getTranslations('analytics');
  const tCommon = await getTranslations('common');
  const intlLocale = params.locale === 'en' ? 'en-US' : 'ru-RU';
  const categoryLabels = NEWS_CATEGORY_LABELS[params.locale === 'en' ? 'en' : 'ru']!;

  // Микроразметка NewsArticle для поисковиков
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: article.title,
    description: article.excerpt,
    datePublished: article.publishedAt,
    author: { '@type': 'Organization', name: article.source },
    publisher: { '@type': 'Organization', name: 'Apex Capital' },
  };

  return (
    <article className="mx-auto max-w-3xl">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <nav className="text-sm text-secondary">
        <Link href="/analytics/news" className="hover:text-primary">
          {t('backAll')}
        </Link>
      </nav>

      <div className="mt-6 flex flex-wrap items-center gap-3 text-xs text-secondary">
        <Badge variant="accent" className="px-3 py-1 text-xs">
          {categoryLabels[article.category]}
        </Badge>
        <time dateTime={article.publishedAt}>
          {formatDate(article.publishedAt, intlLocale)} ·{' '}
          {formatTime(article.publishedAt, intlLocale)}
        </time>
        <span>· {tCommon('minRead', { minutes: article.readingMinutes })}</span>
      </div>

      <h1 className="mt-4 text-2xl font-semibold leading-snug tracking-tight text-primary sm:text-3xl lg:text-4xl">
        {article.title}
      </h1>

      <p className="mt-4 text-lg leading-relaxed text-secondary">{article.excerpt}</p>

      <div className="mt-8 space-y-5 border-t border-border pt-8">
        {article.body.map((paragraph, i) => (
          <p key={i} className="leading-relaxed text-primary/90">
            {paragraph}
          </p>
        ))}
      </div>

      <p className="mt-8 text-sm text-secondary">{t('source', { source: article.source })}</p>

      <div className="mt-10 rounded-2xl border border-accent/20 bg-accent/5 p-6 text-center">
        <p className="font-medium text-primary">{t('articleCta')}</p>
        <Link href="/register" className="mt-4 inline-block">
          <Button tabIndex={-1}>{tCommon('openAccount')}</Button>
        </Link>
      </div>
    </article>
  );
}
