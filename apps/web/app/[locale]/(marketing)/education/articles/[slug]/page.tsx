import { pageLocale } from '@/lib/locale';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Button } from '@broker/ui';
import { Link } from '@/i18n/navigation';
import { ArticleCover, ScheduledBadge, scheduledLabel } from '@/components/ArticleMeta';
import { ArticleBody } from '@/components/RichText';
import { StreamFacade } from '@/features/streams/StreamFacade';
import { LEVEL_LABEL_KEY, findEducationArticle, loadEducationArticles } from '@/lib/articles';
import { brandName } from '@/lib/brand';
import { staticParamsFromCms } from '@/lib/cms';

interface PageParams {
  params: { locale: string; slug: string };
}

function findArticle(locale: string, slug: string) {
  return findEducationArticle(pageLocale(locale), slug);
}

export function generateStaticParams({ params }: { params: { locale: string } }) {
  return staticParamsFromCms(async () =>
    (await loadEducationArticles(pageLocale(params.locale))).map((a) => ({ slug: a.slug })),
  );
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const article = await findArticle(params.locale, params.slug);
  if (!article) return {};
  return { title: article.title, description: article.excerpt };
}

export default async function EducationArticlePage({ params }: PageParams) {
  setRequestLocale(params.locale);

  const article = await findArticle(params.locale, params.slug);
  if (!article) notFound();
  const organization = await brandName(params.locale);
  const t = await getTranslations('education');
  const tCommon = await getTranslations('common');
  const scheduled = await scheduledLabel(article.publishedAt, params.locale);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.excerpt,
    ...(article.publishedAt ? { datePublished: article.publishedAt } : {}),
    ...(article.cover ? { image: article.cover.url } : {}),
    author: { '@type': 'Organization', name: organization },
    publisher: { '@type': 'Organization', name: organization },
  };

  return (
    <article className="mx-auto max-w-3xl">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <nav className="text-sm text-secondary">
        <Link href="/education/articles" className="hover:text-primary">
          {t('backArticles')}
        </Link>
      </nav>

      <div className="mt-6 flex items-center gap-3 text-xs">
        <span className="rounded-full bg-accent/10 px-2.5 py-1 text-accent">
          {t(LEVEL_LABEL_KEY[article.level])}
        </span>
        <span className="text-secondary">
          {tCommon('minRead', { minutes: article.readingMinutes })}
        </span>
      </div>

      <h1 className="mt-4 text-2xl font-semibold leading-snug tracking-tight text-primary sm:text-3xl lg:text-4xl">
        {article.title}
      </h1>

      {scheduled && <ScheduledBadge label={scheduled} />}

      {article.cover && <ArticleCover cover={article.cover} />}

      {article.video && (
        <section aria-label={t('articleVideo')} className="mt-8">
          <StreamFacade provider={article.video.provider} videoId={article.video.videoId} title={article.title} />
        </section>
      )}

      <div className="mt-8 space-y-5 border-t border-border pt-8">
        <ArticleBody body={article.body} bodyMarkdown={article.bodyMarkdown} title={article.title} />
      </div>

      <div className="mt-10 rounded-2xl border border-accent/20 bg-accent/5 p-6 text-center">
        <p className="font-medium text-primary">{t('articleCta')}</p>
        <Link href="/register?demo=1" className="mt-4 inline-block">
          <Button tabIndex={-1}>{t('articleCtaButton')}</Button>
        </Link>
      </div>
    </article>
  );
}
