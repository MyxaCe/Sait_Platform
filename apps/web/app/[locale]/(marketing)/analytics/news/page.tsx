import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Badge } from '@broker/ui';
import { formatDate, formatTime } from '@broker/utils';
import { Link } from '@/i18n/navigation';
import { NEWS_CATEGORY_LABELS, type NewsCategory } from '@/features/analytics/news-data';
import { getCms } from '@/lib/cms';

interface PageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'analytics' });
  return { title: t('newsMetaTitle'), description: t('newsMetaDescription') };
}

export default async function NewsPage({ params }: PageProps) {
  setRequestLocale(params.locale);
  const t = await getTranslations('analytics');
  const tCommon = await getTranslations('common');
  const locale = params.locale;
  const intlLocale = locale === 'en' ? 'en-US' : 'ru-RU';
  const categoryLabels = NEWS_CATEGORY_LABELS[locale === 'en' ? 'en' : 'ru']!;

  // Новости из CMS (тег cms:articles, условно-динамические → revalidate 60 c)
  const { items } = await getCms('articles', {
    locale: locale === 'en' ? 'en' : 'ru',
    revalidate: 60,
  });
  const [featured, ...rest] = items.map((a) => ({
    ...a,
    category: a.category as NewsCategory,
  }));
  if (!featured) return null;

  return (
    <div>
      {/* Главная новость */}
      <Link
        href={`/analytics/news/${featured.slug}`}
        className="group block overflow-hidden rounded-3xl border border-border bg-card p-6 transition-colors hover:border-accent/40 sm:p-8 lg:p-10"
      >
        <div className="flex flex-wrap items-center gap-3 text-xs text-secondary">
          <Badge variant="accent" className="px-3 py-1 text-xs">
            {categoryLabels[featured.category]}
          </Badge>
          <time dateTime={featured.publishedAt}>
            {formatDate(featured.publishedAt, intlLocale)} ·{' '}
            {formatTime(featured.publishedAt, intlLocale)}
          </time>
          <span>· {tCommon('minRead', { minutes: featured.readingMinutes })}</span>
        </div>
        <h2 className="mt-4 max-w-3xl text-2xl font-semibold leading-snug tracking-tight text-primary group-hover:text-accent sm:text-3xl">
          {featured.title}
        </h2>
        <p className="mt-3 max-w-3xl leading-relaxed text-secondary">{featured.excerpt}</p>
        <span className="mt-5 inline-block text-sm font-medium text-accent">{t('readFull')}</span>
      </Link>

      {/* Остальные новости */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
        {rest.map((article) => (
          <Link
            key={article.slug}
            href={`/analytics/news/${article.slug}`}
            className="group flex flex-col rounded-2xl border border-border bg-card p-6 transition-colors hover:border-accent/40"
          >
            <div className="flex flex-wrap items-center gap-2 text-xs text-secondary">
              <span className="font-medium text-accent">{categoryLabels[article.category]}</span>
              <span aria-hidden>·</span>
              <time dateTime={article.publishedAt}>
                {formatDate(article.publishedAt, intlLocale)}
              </time>
            </div>
            <h3 className="mt-3 font-semibold leading-snug text-primary group-hover:text-accent">
              {article.title}
            </h3>
            <p className="mt-2 line-clamp-3 flex-1 text-sm leading-relaxed text-secondary">
              {article.excerpt}
            </p>
            <span className="mt-4 text-xs text-secondary">
              {tCommon('minRead', { minutes: article.readingMinutes })}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
