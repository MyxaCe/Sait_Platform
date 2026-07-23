import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Container, Section } from '@broker/ui';
import { formatDate } from '@broker/utils';
import { Link } from '@/i18n/navigation';
import { getBlogPosts, type BlogCategory } from '@/features/blog/posts-data';

interface PageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'blog' });
  return { title: t('metaTitle'), description: t('metaDescription') };
}

export default async function BlogPage({ params }: PageProps) {
  setRequestLocale(params.locale);
  const t = await getTranslations('blog');
  const tCommon = await getTranslations('common');
  const intlLocale = params.locale === 'en' ? 'en-US' : 'ru-RU';
  const categoryLabels = t.raw('categoryLabels') as Record<BlogCategory, string>;
  const posts = getBlogPosts(params.locale);

  return (
    <Section className="py-10 md:py-14">
      <Container>
        <div className="max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-tight text-primary sm:text-4xl lg:text-5xl">
            {t('title')}
          </h1>
          <p className="mt-3 text-secondary sm:text-lg">{t('subtitle')}</p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:gap-6">
          {posts.map((post) => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              className="group flex flex-col rounded-2xl border border-border bg-card p-6 transition-colors hover:border-accent/40 lg:p-8"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-secondary">
                <span className="font-medium text-accent">{categoryLabels[post.category]}</span>
                <span aria-hidden>·</span>
                <time dateTime={post.publishedAt}>{formatDate(post.publishedAt, intlLocale)}</time>
                <span aria-hidden>·</span>
                <span>{tCommon('minRead', { minutes: post.readingMinutes })}</span>
              </div>
              <h2 className="mt-3 text-lg font-semibold leading-snug text-primary group-hover:text-accent">
                {post.title}
              </h2>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-secondary">{post.excerpt}</p>
              <span className="mt-4 text-sm font-medium text-accent">{tCommon('read')}</span>
            </Link>
          ))}
        </div>
      </Container>
    </Section>
  );
}
