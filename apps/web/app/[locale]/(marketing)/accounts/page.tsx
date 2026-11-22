import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Callout, Container, Section, cn } from '@broker/ui';
import { CtaBand } from '@/components/home/CtaBand';
import { CabinetRegisterLink } from '@/components/layout/CabinetRegisterLink';
import { accountOffers, formatBpsPercent, portfolioLeverage, publicPortfolios, type AccountOffer } from '@broker/live-params';
import { TERMINAL_INSTRUMENT_CLASS } from '@broker/money';
import { getCms } from '@/lib/cms';
import { pageLocale } from '@/lib/locale';
import { fetchLiveSnapshot } from '@/lib/platform-terms';

interface PageProps {
  params: { locale: string };
}

export const revalidate = 60;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'accounts' });
  return { title: t('title'), description: t('metaDescription') };
}

export default async function AccountsPage({ params }: PageProps) {
  setRequestLocale(params.locale);
  const t = await getTranslations('accounts');
  const [snapshot, plans] = await Promise.all([
    fetchLiveSnapshot(),
    getCms('accounts', { locale: pageLocale(params.locale), revalidate: 60 })
      .then((r) => r.items)
      .catch(() => null),
  ]);
  const portfolios = publicPortfolios(snapshot);
  const types = portfolios === null ? null : accountOffers(portfolios, plans);

  return (
    <>
      <Section className="py-10 md:py-14">
        <Container>
          <div className="max-w-2xl">
            <h1 className="text-3xl font-semibold tracking-tight text-primary sm:text-4xl lg:text-5xl">{t('title')}</h1>
            <p className="mt-3 text-secondary sm:text-lg">{t('subtitle')}</p>
          </div>

          {types === null ? (
            <Callout tone="warning" title={t('unavailableTitle')} className="mt-10 max-w-2xl">
              {t('unavailable')}
            </Callout>
          ) : types.length === 0 ? (
            <p className="mt-10 text-secondary">{t('empty')}</p>
          ) : (
            <div
              className={cn('mt-10 grid gap-4 lg:mt-14 lg:gap-6', types.length >= 3 ? 'lg:grid-cols-3' : 'md:grid-cols-2')}
              data-testid="account-types"
            >
              {types.map((offer) => (
                <AccountCard key={offer.portfolio.key} offer={offer} locale={params.locale} />
              ))}
            </div>
          )}
        </Container>
      </Section>

      <CtaBand />
    </>
  );
}

async function AccountCard({ offer, locale }: { offer: AccountOffer; locale: string }) {
  const t = await getTranslations('accounts');
  const a = offer.portfolio;
  const fee =
    a.markupBps > 0 && a.commissionBps > 0
      ? t('fee.both', { markup: formatBpsPercent(a.markupBps, locale), commission: formatBpsPercent(a.commissionBps, locale) })
      : a.markupBps > 0
        ? t('fee.markup', { markup: formatBpsPercent(a.markupBps, locale) })
        : a.commissionBps > 0
          ? t('fee.commission', { commission: formatBpsPercent(a.commissionBps, locale) })
          : t('fee.none');
  const classNames = (t.raw('classes') ?? {}) as Record<string, string>;
  const classes = Object.entries(a.classOverrides);

  return (
    <article
      className={cn(
        'flex flex-col rounded-2xl border bg-elevated p-6',
        offer.featured || a.isDefault ? 'border-accent/50' : 'border-border',
      )}
      data-account-type={a.key}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-2xl font-semibold tracking-tight text-primary">{a.title}</h2>
        {a.isDefault ? (
          <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-medium text-accent">{t('default')}</span>
        ) : null}
      </div>
      {offer.description ? <p className="mt-2 text-sm text-secondary">{offer.description}</p> : null}
      <dl className="mt-6 flex-1 divide-y divide-border border-y border-border">
        <div className="py-3">
          <dt className="text-xs text-muted">{t('leverage')}</dt>
          <dd className="mt-0.5 text-lg font-semibold tabular-nums text-primary">
            {t('leverageValue', { n: portfolioLeverage(a, TERMINAL_INSTRUMENT_CLASS) })}
          </dd>
          {classes.length > 0 ? (
            <dd className="text-xs text-muted">
              {[
                t('leverageBase', { n: a.baseLeverage }),
                ...classes.map(([cls, n]) => t('classLeverage', { class: classNames[cls] ?? cls, n })),
              ].join(' · ')}
            </dd>
          ) : null}
        </div>
        <div className="py-3">
          <dt className="text-xs text-muted">{t('cost')}</dt>
          <dd className="mt-0.5 text-sm font-medium text-primary">{fee}</dd>
        </div>
        <div className="py-3">
          <dt className="text-xs text-muted">{t('instruments')}</dt>
          <dd className={cn('mt-0.5 text-sm', a.instruments ? 'text-primary' : 'text-muted')}>
            {a.instruments ?? t('notSpecified')}
          </dd>
        </div>
        {offer.features.map((f) => (
          <div key={`${f.label}:${f.value}`} className="py-3">
            <dt className="text-xs text-muted">{f.label}</dt>
            <dd className="mt-0.5 text-sm text-primary">{f.value}</dd>
          </div>
        ))}
      </dl>
      <CabinetRegisterLink
        href={`/register?accountType=${encodeURIComponent(a.key)}`}
        className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-accent px-4 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
      >
        {t('openCta')}
      </CabinetRegisterLink>
    </article>
  );
}
