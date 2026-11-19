import { pageLocale } from '@/lib/locale';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { promotionOffers } from '@broker/live-params';
import { Badge, Button, Callout, Container, Section } from '@broker/ui';
import { Link } from '@/i18n/navigation';
import { getCms } from '@/lib/cms';
import { brandName } from '@/lib/brand';
import { cabinetRegisterHref } from '@/lib/cabinet-links';
import { fetchLiveSnapshot } from '@/lib/platform-terms';
import { getSiteLanguages } from '@/lib/site-languages';

interface PageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'promotions' });
  return {
    title: t('metaTitle'),
    description: t('metaDescription', { brand: await brandName(params.locale) }),
  };
}

export default async function PromotionsPage({ params }: PageProps) {
  setRequestLocale(params.locale);
  const t = await getTranslations('promotions');
  const { defaultLanguage } = await getSiteLanguages();
  const [snapshot, cms] = await Promise.all([
    fetchLiveSnapshot(),
    getCms('promotions', { locale: pageLocale(params.locale), revalidate: 60 })
      .then((r) => r.items)
      .catch(() => null),
  ]);
  const promos = snapshot?.promotions ? promotionOffers(snapshot.promotions, cms, params.locale) : null;

  return (
    <Section className="py-10 md:py-14">
      <Container>
        <div className="max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-tight text-primary sm:text-4xl lg:text-5xl">
            {t('title')}
          </h1>
          <p className="mt-3 text-secondary sm:text-lg">{t('subtitle')}</p>
        </div>

        {promos === null ? (
          <Callout tone="warning" title={t('unavailableTitle')} className="mt-10 max-w-2xl">
            {t('unavailable')}
          </Callout>
        ) : promos.length === 0 ? (
          <p className="mt-10 text-secondary">{t('empty')}</p>
        ) : (
          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:gap-6" data-testid="promotions">
            {promos.map((promo) => (
              <article
                key={promo.id}
                data-promotion={promo.slug}
                className={
                  promo.featured
                    ? 'relative flex flex-col rounded-3xl border border-accent bg-accent/5 p-6 lg:p-8'
                    : 'flex flex-col rounded-3xl border border-border bg-card p-6 lg:p-8'
                }
              >
                {promo.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- картинка акции из CMS
                  <img
                    src={promo.image.url}
                    alt={promo.image.alt}
                    width={promo.image.width}
                    height={promo.image.height}
                    className="mb-4 h-auto w-full rounded-2xl object-cover"
                  />
                ) : null}
                {promo.badge ? (
                  <Badge variant={promo.featured ? 'accent' : 'neutral'} className="self-start px-3 py-1 text-xs">
                    {promo.badge}
                  </Badge>
                ) : null}
                <h2 className="mt-4 text-xl font-semibold text-primary">{promo.title}</h2>
                <p className="mt-3 flex-1 leading-relaxed text-secondary">{promo.description}</p>
                {promo.terms ? (
                  <p className="mt-4 whitespace-pre-line rounded-xl bg-elevated px-4 py-3 text-xs leading-relaxed text-secondary">
                    {promo.terms}
                  </p>
                ) : null}
                <Link href={cabinetRegisterHref(promo.ctaHref, params.locale, defaultLanguage)} className="mt-5 block">
                  <Button variant={promo.featured ? 'primary' : 'secondary'} className="w-full" tabIndex={-1}>
                    {promo.ctaLabel ?? t('cta')}
                  </Button>
                </Link>
              </article>
            ))}
          </div>
        )}

        <p className="mt-10 text-xs leading-relaxed text-secondary">{t('disclaimer')}</p>
      </Container>
    </Section>
  );
}
