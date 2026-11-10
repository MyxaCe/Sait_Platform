import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Container, Section } from '@broker/ui';
import { brandName } from '@/lib/brand';

interface PageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'blog' });
  return {
    title: t('metaTitle'),
    description: t('metaDescription', { brand: await brandName(params.locale) }),
    // Пустой раздел не индексируем
    robots: { index: false, follow: true },
  };
}

/**
 * Блог компании — коллекции в legacy CMS нет.
 *
 * Посты жили в коде (`features/blog/posts-data.ts`) и удалены 10.11
 * вместе с остальным контентом в коде. До появления коллекции (CMS v2:
 * `articles` с рубрикой) раздел честно пуст.
 */
export default async function BlogPage({ params }: PageProps) {
  setRequestLocale(params.locale);
  const t = await getTranslations('blog');

  return (
    <Section className="py-10 md:py-14">
      <Container>
        <div className="max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-tight text-primary sm:text-4xl lg:text-5xl">
            {t('title')}
          </h1>
          <p className="mt-3 text-secondary sm:text-lg">{t('subtitle')}</p>
        </div>
        <p className="mt-10 rounded-2xl border border-border bg-card p-8 text-center text-secondary">
          {t('empty')}
        </p>
      </Container>
    </Section>
  );
}
