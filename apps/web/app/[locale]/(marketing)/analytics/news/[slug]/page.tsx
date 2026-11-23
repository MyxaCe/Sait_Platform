import { intlTag, pageLocale } from '@/lib/locale';
import { BreadcrumbJsonLd } from '@/components/seo/BreadcrumbJsonLd';
import { jsonLdHtml } from '@/lib/seo/json-ld';
import { absoluteUrl } from '@/lib/seo/absolute-url';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Badge, Button } from '@broker/ui';
import { formatDate, formatTime } from '@broker/utils';
import { Link } from '@/i18n/navigation';
import { ArticleCover, ScheduledBadge, scheduledLabel } from '@/components/ArticleMeta';
import { ArticleBody } from '@/components/RichText';
import { findNews, loadNews } from '@/lib/articles';
import { brandName } from '@/lib/brand';
import { staticParamsFromCms } from '@/lib/cms';

interface PageParams {
  params: { locale: string; slug: string };
}

export function generateStaticParams({ params }: { params: { locale: string } }) {
  return staticParamsFromCms(async () =>
    (await loadNews(pageLocale(params.locale))).map((a) => ({ slug: a.slug })),
  );
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const article = await findNews(pageLocale(params.locale), params.slug);
  if (!article) return {};
  return {
    title: article.title,
    description: article.excerpt,
    openGraph: {
      type: 'article',
      title: article.title,
      description: article.excerpt,
      publishedTime: article.publishedAt,
      ...(article.cover ? { images: [{ url: article.cover.url, width: article.cover.width, height: article.cover.height }] } : {}),
    },
  };
}

export default async function NewsArticlePage({ params }: PageParams) {
  setRequestLocale(params.locale);
  const locale = pageLocale(params.locale);

  const article = await findNews(locale, params.slug);
  if (!article) notFound();
  const publisher = await brandName(locale);
  const t = await getTranslations('analytics');
  const tCommon = await getTranslations('common');
  const scheduled = await scheduledLabel(article.publishedAt, params.locale);
  const intlLocale = intlTag(params.locale);
  const categoryLabel =
    article.categoryTitle ??
    (t.has(`categories.${article.category}`) ? t(`categories.${article.category}`) : article.category);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: article.title,
    description: article.excerpt,
    datePublished: article.publishedAt,
    ...(article.cover ? { image: article.cover.url } : {}),
    author: { '@type': 'Organization', name: article.source },
    publisher: { '@type': 'Organization', name: publisher },
  };

  return (
    <article className="mx-auto max-w-3xl">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }}
      />
      <BreadcrumbJsonLd
        crumbs={[
          { name: t('title'), url: await absoluteUrl('/analytics', params.locale) },
          { name: t('tabNews'), url: await absoluteUrl('/analytics/news', params.locale) },
          { name: article.title, url: await absoluteUrl(`/analytics/news/${params.slug}`, params.locale) },
        ]}
      />

      <nav className="text-sm text-secondary">
        <Link href="/analytics/news" className="hover:text-primary">
          {t('backAll')}
        </Link>
      </nav>

      <div className="mt-6 flex flex-wrap items-center gap-3 text-xs text-secondary">
        <Badge variant="accent" className="px-3 py-1 text-xs">
          {categoryLabel}
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

      {scheduled && <ScheduledBadge label={scheduled} />}

      <p className="mt-4 text-lg leading-relaxed text-secondary">{article.excerpt}</p>

      {article.cover && <ArticleCover cover={article.cover} />}

      <div className="mt-8 space-y-5 border-t border-border pt-8">
        <ArticleBody body={article.body} bodyMarkdown={article.bodyMarkdown} title={article.title} />
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
