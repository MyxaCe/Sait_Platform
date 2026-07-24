import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Badge, Button, Container, Section } from '@broker/ui';
import { Link } from '@/i18n/navigation';
import { getCms } from '@/lib/cms';

interface PageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'promotions' });
  return { title: t('metaTitle'), description: t('metaDescription') };
}

export default async function PromotionsPage({ params }: PageProps) {
  setRequestLocale(params.locale);
  const t = await getTranslations('promotions');
  // Акции из CMS (тег cms:promotions, страховочный revalidate 60 c —
  // условно-динамические данные из классификации §1 задания)
  const { items: promos } = await getCms('promotions', {
    locale: params.locale === 'en' ? 'en' : 'ru',
    revalidate: 60,
  });

  return (
    <Section className="py-10 md:py-14">
      <Container>
        <div className="max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-tight text-primary sm:text-4xl lg:text-5xl">
            {t('title')}
          </h1>
          <p className="mt-3 text-secondary sm:text-lg">{t('subtitle')}</p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:gap-6">
          {promos.map((promo) => (
            <article
              key={promo.title}
              className={
                promo.featured
                  ? 'relative flex flex-col rounded-3xl border border-accent bg-accent/5 p-6 lg:p-8'
                  : 'flex flex-col rounded-3xl border border-border bg-card p-6 lg:p-8'
              }
            >
              <Badge variant={promo.featured ? 'accent' : 'neutral'} className="self-start px-3 py-1 text-xs">
                {promo.badge}
              </Badge>
              <h2 className="mt-4 text-xl font-semibold text-primary">{promo.title}</h2>
              <p className="mt-3 flex-1 leading-relaxed text-secondary">{promo.description}</p>
              <p className="mt-4 rounded-xl bg-elevated px-4 py-3 text-xs leading-relaxed text-secondary">
                {promo.terms}
              </p>
              <Link href={promo.ctaHref} className="mt-5 block">
                <Button
                  variant={promo.featured ? 'primary' : 'secondary'}
                  className="w-full"
                  tabIndex={-1}
                >
                  {promo.ctaLabel}
                </Button>
              </Link>
            </article>
          ))}
        </div>

        <p className="mt-10 text-xs leading-relaxed text-secondary">{t('disclaimer')}</p>
      </Container>
    </Section>
  );
}
