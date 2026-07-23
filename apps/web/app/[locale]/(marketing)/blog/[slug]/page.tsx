import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Badge, Container, Section } from '@broker/ui';
import { formatDate } from '@broker/utils';
import { Link } from '@/i18n/navigation';
import {
  BLOG_SLUGS,
  findBlogPost,
  type BlogCategory,
} from '@/features/blog/posts-data';

interface PageParams {
  params: { locale: string; slug: string };
}

export function generateStaticParams() {
  return BLOG_SLUGS.map((slug) => ({ slug }));
}

export function generateMetadata({ params }: PageParams): Metadata {
  const post = findBlogPost(params.slug, params.locale);
  if (!post) return {};
  return {
    title: post.title,
    description: post.excerpt,
    openGraph: {
      type: 'article',
      title: post.title,
      description: post.excerpt,
      publishedTime: post.publishedAt,
    },
  };
}

export default async function BlogPostPage({ params }: PageParams) {
  setRequestLocale(params.locale);
  const post = findBlogPost(params.slug, params.locale);
  if (!post) notFound();
  const t = await getTranslations('blog');
  const tCommon = await getTranslations('common');
  const intlLocale = params.locale === 'en' ? 'en-US' : 'ru-RU';
  const categoryLabels = t.raw('categoryLabels') as Record<BlogCategory, string>;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.excerpt,
    datePublished: post.publishedAt,
    author: { '@type': 'Organization', name: 'Apex Capital' },
    publisher: { '@type': 'Organization', name: 'Apex Capital' },
  };

  return (
    <Section className="py-10 md:py-14">
      <Container>
        <article className="mx-auto max-w-3xl">
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
          />

          <nav className="text-sm text-secondary">
            <Link href="/blog" className="hover:text-primary">
              {t('backAll')}
            </Link>
          </nav>

          <div className="mt-6 flex flex-wrap items-center gap-3 text-xs text-secondary">
            <Badge variant="accent" className="px-3 py-1 text-xs">
              {categoryLabels[post.category]}
            </Badge>
            <time dateTime={post.publishedAt}>{formatDate(post.publishedAt, intlLocale)}</time>
            <span>· {tCommon('minRead', { minutes: post.readingMinutes })}</span>
          </div>

          <h1 className="mt-4 text-2xl font-semibold leading-snug tracking-tight text-primary sm:text-3xl lg:text-4xl">
            {post.title}
          </h1>

          <p className="mt-4 text-lg leading-relaxed text-secondary">{post.excerpt}</p>

          <div className="mt-8 space-y-5 border-t border-border pt-8">
            {post.body.map((paragraph, i) => (
              <p key={i} className="leading-relaxed text-primary/90">
                {paragraph}
              </p>
            ))}
          </div>
        </article>
      </Container>
    </Section>
  );
}
