import { pageLocale } from '@/lib/locale';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Badge, Container, Section } from '@broker/ui';
import { Link } from '@/i18n/navigation';
import { AccessNotice } from '@/features/instruments/AccessNotice';
import { LiveQuotePanel } from '@/features/instruments/LiveQuotePanel';
import { resolveInstrument } from '@/features/instruments/instrument-detail';
import { marketsFromOutcome, unavailableReasonsOf } from '@/features/instruments/unavailable-map';
import { defaultPortfolio, formatBpsPercent, formatLeverage, MISSING_VALUE, portfolioLeverage } from '@broker/live-params';
import { cabinetTerminalHref } from '@/lib/cabinet-links';
import { getCms } from '@/lib/cms';
import { fetchLiveSnapshot } from '@/lib/platform-terms';
import { getMdsCatalogEntries, getMdsIcons, getMdsQuotesState } from '@/lib/mds';
import { getSiteLanguages } from '@/lib/site-languages';
import { SITE_URL } from '@/lib/site';
import { getTenantAccess } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

interface PageParams {
  params: { locale: string; category: string; symbol: string };
}

const loadInstrument = cache(async (locale: string, category: string, symbol: string) => {
  const [{ items }, access, catalog] = await Promise.all([
    getCms('instruments', { locale: pageLocale(locale) }),
    getTenantAccess(),
    getMdsCatalogEntries(),
  ]);
  return resolveInstrument({ category, symbol, cmsItems: items, access, catalog });
});

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const detail = await loadInstrument(params.locale, params.category, params.symbol);
  if (detail.kind !== 'ok') return {};
  const { name, symbol, category: cat } = detail.instrument;
  const t = await getTranslations({ locale: params.locale, namespace: 'instruments' });
  const category = (await getTranslations({ locale: params.locale, namespace: 'categories' }))(cat);
  return {
    title: t('metaDetailTitle', { name, symbol }),
    description: t('metaDetail', { name, category }),
  };
}

export default async function InstrumentPage({ params }: PageParams) {
  setRequestLocale(params.locale);
  const locale = pageLocale(params.locale);

  const detail = await loadInstrument(params.locale, params.category, params.symbol);
  if (detail.kind === 'not-found') notFound();

  const t = await getTranslations('instruments');

  if (detail.kind === 'closed') {
    const { notice } = detail;
    return (
      <Section className="py-10 md:py-14">
        <Container>
          <h1 className="text-3xl font-semibold tracking-tight text-primary sm:text-4xl">
            {detail.name} <span className="text-secondary">({detail.symbol})</span>
          </h1>
          <div className="mt-6 max-w-2xl">
            <AccessNotice
              state={notice.state}
              title={t(notice.titleKey)}
              text={t(notice.textKey)}
              reason={notice.reason}
              reasonLabel={notice.reason && t('accessReason', { reason: notice.reason })}
            />
          </div>
        </Container>
      </Section>
    );
  }

  const def = detail.instrument;
  const [mdsIcons, snapshot, quotes, site] = await Promise.all([
    def.cmsIconUrl ? Promise.resolve({} as Record<string, string>) : getMdsIcons(),
    fetchLiveSnapshot(),
    getMdsQuotesState(),
    getSiteLanguages(),
  ]);
  const iconUrl = def.cmsIconUrl ?? mdsIcons[def.symbol];
  const portfolio = defaultPortfolio(snapshot);
  const leverage = portfolio ? formatLeverage(portfolioLeverage(portfolio, def.category)) : MISSING_VALUE;
  const commission = portfolio ? formatBpsPercent(portfolio.commissionBps, locale) : MISSING_VALUE;
  const unavailableReason = unavailableReasonsOf(quotes)[def.symbol];
  const market = marketsFromOutcome(quotes)[def.symbol] ?? null;
  const tradeHref = cabinetTerminalHref('real', def.symbol, locale, site.defaultLanguage);
  const demoHref = cabinetTerminalHref('demo', def.symbol, locale, site.defaultLanguage);

  const categoryLabel = (await getTranslations({ locale, namespace: 'categories' }))(def.category);

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
            <div className="flex items-center gap-4">
              {iconUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- SVG с MDS/CMS
                <img src={iconUrl} alt="" width={48} height={48} className="h-12 w-12 rounded-full" />
              )}
              <h1 className="text-3xl font-semibold tracking-tight text-primary sm:text-4xl lg:text-5xl">
                {def.name} <span className="text-secondary">({def.symbol})</span>
              </h1>
            </div>
            <p className="mt-4 max-w-xl text-secondary sm:text-lg">
              {t('detailSubtitle', { name: def.name })}
            </p>

            <dl className="mt-8 grid grid-cols-2 gap-6 sm:grid-cols-3">
              {def.minQty && (
                <div>
                  <dt className="text-sm text-secondary">{t('specMinLot')}</dt>
                  <dd className="mt-1 font-medium text-primary">{def.minQty}</dd>
                </div>
              )}
              <div>
                <dt className="text-sm text-secondary">{t('specLeverage')}</dt>
                <dd className="mt-1 font-medium text-primary" data-testid="instrument-leverage">
                  {leverage}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-secondary">{t('specCommission')}</dt>
                <dd className="mt-1 font-medium text-primary">{commission}</dd>
              </div>
              <div>
                <dt className="text-sm text-secondary">{t('specHours')}</dt>
                <dd className="mt-1 font-medium text-primary">
                  {def.category === 'crypto' ? t('specHours247') : t('specHoursWeekdays')}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-secondary">{t('specPrecision')}</dt>
                <dd className="mt-1 font-medium text-primary" data-testid="instrument-precision">
                  {def.digits === null ? MISSING_VALUE : t('specPrecisionValue', { digits: def.digits })}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-secondary">{t('specSwapFree')}</dt>
                <dd className="mt-1 font-medium text-primary">
                  {def.swapFree ? t('specAvailable') : '—'}
                </dd>
              </div>
            </dl>
          </div>

          <LiveQuotePanel
            symbol={def.symbol}
            unavailableReason={unavailableReason}
            market={market}
            tradeHref={tradeHref}
            demoHref={demoHref}
          />
        </div>
      </Container>
    </Section>
  );
}
