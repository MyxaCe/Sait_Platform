import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { findSymbol, SYMBOL_UNIVERSE } from '@broker/realtime';
import { Badge, Container, Section } from '@broker/ui';
import { Link } from '@/i18n/navigation';
import { CATEGORY_LABELS_STATIC } from '@/features/instruments/categories';
import { LiveQuotePanel } from '@/features/instruments/LiveQuotePanel';
import { SITE_URL } from '@/lib/site';

interface PageParams {
  params: { locale: string; category: string; symbol: string };
}

export function generateStaticParams() {
  return SYMBOL_UNIVERSE.map((d) => ({
    category: d.category,
    symbol: d.symbol.toLowerCase(),
  }));
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const def = findSymbol(params.symbol);
  if (!def) return {};
  const t = await getTranslations({ locale: params.locale, namespace: 'instruments' });
  const category =
    CATEGORY_LABELS_STATIC[params.locale === 'en' ? 'en' : 'ru']![def.category];
  return {
    title: t('metaDetailTitle', { name: def.name, symbol: def.symbol }),
    description: t('metaDetail', { name: def.name, category }),
  };
}

export default async function InstrumentPage({ params }: PageParams) {
  // setRequestLocale строго до notFound(): иначе рендер 404-границы
  // уходит в динамический режим (DYNAMIC_SERVER_USAGE)
  setRequestLocale(params.locale);
  const def = findSymbol(params.symbol);
  if (!def || def.category !== params.category) notFound();
  const t = await getTranslations('instruments');
  const categoryLabel =
    CATEGORY_LABELS_STATIC[params.locale === 'en' ? 'en' : 'ru']![def.category];

  // Микроразметка хлебных крошек — дублирует видимую навигацию для поисковиков
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: t('breadcrumbRoot'),
        item: `${SITE_URL}/instruments`,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: categoryLabel,
        item: `${SITE_URL}/instruments?category=${def.category}`,
      },
      { '@type': 'ListItem', position: 3, name: def.symbol },
    ],
  };

  return (
    <Section className="py-10 md:py-14">
      <Container>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
        />
        <nav aria-label={t('breadcrumbs')} className="text-sm text-secondary">
          <ol className="flex flex-wrap items-center gap-2">
            <li>
              <Link href="/instruments" className="hover:text-primary">
                {t('breadcrumbRoot')}
              </Link>
            </li>
            <li aria-hidden>/</li>
            <li>
              <Link href={`/instruments?category=${def.category}`} className="hover:text-primary">
                {categoryLabel}
              </Link>
            </li>
            <li aria-hidden>/</li>
            <li aria-current="page" className="text-primary">
              {def.symbol}
            </li>
          </ol>
        </nav>

        <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_420px] lg:gap-12">
          <div>
            <Badge variant="neutral" className="mb-4">
              {categoryLabel}
            </Badge>
            <h1 className="text-3xl font-semibold tracking-tight text-primary sm:text-4xl lg:text-5xl">
              {def.name} <span className="text-secondary">({def.symbol})</span>
            </h1>
            <p className="mt-4 max-w-xl text-secondary sm:text-lg">
              {t('detailSubtitle', { name: def.name })}
            </p>

            <dl className="mt-8 grid grid-cols-2 gap-6 sm:grid-cols-3">
              <div>
                <dt className="text-sm text-secondary">{t('specMinLot')}</dt>
                <dd className="mt-1 font-medium text-primary">0.01</dd>
              </div>
              <div>
                <dt className="text-sm text-secondary">{t('specLeverage')}</dt>
                <dd className="mt-1 font-medium text-primary">1:500</dd>
              </div>
              <div>
                <dt className="text-sm text-secondary">{t('specCommission')}</dt>
                <dd className="mt-1 font-medium text-primary">{t('specCommissionValue')}</dd>
              </div>
              <div>
                <dt className="text-sm text-secondary">{t('specHours')}</dt>
                <dd className="mt-1 font-medium text-primary">
                  {def.category === 'crypto' ? t('specHours247') : t('specHoursWeekdays')}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-secondary">{t('specPrecision')}</dt>
                <dd className="mt-1 font-medium text-primary">
                  {t('specPrecisionValue', { digits: def.digits })}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-secondary">{t('specSwapFree')}</dt>
                <dd className="mt-1 font-medium text-primary">{t('specAvailable')}</dd>
              </div>
            </dl>
          </div>

          <LiveQuotePanel def={def} />
        </div>
      </Container>
    </Section>
  );
}
