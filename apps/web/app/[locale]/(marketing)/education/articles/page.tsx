import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { getCms } from '@/lib/cms';

interface PageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'education' });
  return { title: t('articlesMetaTitle'), description: t('articlesMetaDescription') };
}

export default async function EducationArticlesPage({ params }: PageProps) {
  setRequestLocale(params.locale);
  const t = await getTranslations('education');
  const tCommon = await getTranslations('common');
  // Обучение из CMS (тег cms:academy)
  const { articles } = await getCms('academy', {
    locale: params.locale === 'en' ? 'en' : 'ru',
  });

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:gap-6">
      {articles.map((article) => (
        <Link
          key={article.slug}
          href={`/education/articles/${article.slug}`}
          className="group flex flex-col rounded-2xl border border-border bg-card p-6 transition-colors hover:border-accent/40 lg:p-8"
        >
          <div className="flex items-center gap-2 text-xs">
            <span
              className={
                article.level === 'beginner'
                  ? 'rounded-full bg-positive/10 px-2.5 py-1 text-positive'
                  : 'rounded-full bg-accent/10 px-2.5 py-1 text-accent'
              }
            >
              {article.level === 'beginner' ? t('levelBeginner') : t('levelIntermediate')}
            </span>
            <span className="text-secondary">
              {tCommon('minRead', { minutes: article.readingMinutes })}
            </span>
          </div>
          <h2 className="mt-4 text-lg font-semibold leading-snug text-primary group-hover:text-accent">
            {article.title}
          </h2>
          <p className="mt-2 flex-1 text-sm leading-relaxed text-secondary">{article.excerpt}</p>
          <span className="mt-4 text-sm font-medium text-accent">{tCommon('read')}</span>
        </Link>
      ))}
    </div>
  );
}
