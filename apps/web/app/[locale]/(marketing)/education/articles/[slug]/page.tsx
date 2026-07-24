import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Button } from '@broker/ui';
import { Link } from '@/i18n/navigation';
import { MarkdownText } from '@/components/MarkdownText';
import {
  EDUCATION_SLUGS,
  findEducationArticle,
} from '@/features/education/articles-data';
import { getCms } from '@/lib/cms';

interface PageParams {
  params: { locale: string; slug: string };
}

export function generateStaticParams() {
  return EDUCATION_SLUGS.map((slug) => ({ slug }));
}

export function generateMetadata({ params }: PageParams): Metadata {
  const article = findEducationArticle(params.slug, params.locale);
  if (!article) return {};
  return { title: article.title, description: article.excerpt };
}

export default async function EducationArticlePage({ params }: PageParams) {
  setRequestLocale(params.locale);

  // Статья из CMS (тег cms:academy)
  const { articles } = await getCms('academy', {
    locale: params.locale === 'en' ? 'en' : 'ru',
  });
  const article = articles.find((a) => a.slug === params.slug);
  if (!article) notFound();
  const t = await getTranslations('education');
  const tCommon = await getTranslations('common');

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.excerpt,
    author: { '@type': 'Organization', name: 'Apex Capital' },
    publisher: { '@type': 'Organization', name: 'Apex Capital' },
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
          {article.level === 'beginner' ? t('levelBeginner') : t('levelIntermediate')}
        </span>
        <span className="text-secondary">
          {tCommon('minRead', { minutes: article.readingMinutes })}
        </span>
      </div>

      <h1 className="mt-4 text-2xl font-semibold leading-snug tracking-tight text-primary sm:text-3xl lg:text-4xl">
        {article.title}
      </h1>

      <div className="mt-8 space-y-5 border-t border-border pt-8">
        <MarkdownText markdown={article.bodyMarkdown} />
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
