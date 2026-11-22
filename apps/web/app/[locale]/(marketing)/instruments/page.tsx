import { pageLocale } from '@/lib/locale';
import type { Metadata } from 'next';
import { useTranslations } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Container, Section } from '@broker/ui';
import type { QuoteMarket } from '@broker/realtime';
import { AccessNotice } from '@/features/instruments/AccessNotice';
import { InstrumentsBrowser } from '@/features/instruments/InstrumentsBrowser';
import { marketsFromOutcome, unavailableReasonsOf } from '@/features/instruments/unavailable-map';
import { listInstrumentPages } from '@/features/instruments/instrument-detail';
import { getCms } from '@/lib/cms';
import { getMdsCatalogEntries, getMdsIcons, getMdsQuotesState } from '@/lib/mds';
import { accessNotice, getTenantAccess, type AccessNoticeSpec } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'instruments' });
  return { title: t('title'), description: t('metaDescription') };
}

export default async function InstrumentsPage({ params }: PageProps) {
  setRequestLocale(params.locale);
  const [{ items: cmsItems }, access, quotes, catalog] = await Promise.all([
    getCms('instruments', { locale: pageLocale(params.locale) }),
    getTenantAccess(),
    getMdsQuotesState(),
    getMdsCatalogEntries(),
  ]);
  const notice = accessNotice(access);
  const symbols = listInstrumentPages({ cmsItems, access, catalog }).map((p) => p.symbol);

  const mdsIcons = await getMdsIcons();
  const icons: Record<string, string> = {};
  for (const symbol of symbols) {
    const url = cmsItems.find((i) => i.symbol === symbol)?.icon?.url ?? mdsIcons[symbol];
    if (url) icons[symbol] = url;
  }

  return (
    <PageContent
      symbols={symbols}
      icons={icons}
      notice={notice}
      unavailableReasons={unavailableReasonsOf(quotes)}
      markets={marketsFromOutcome(quotes)}
    />
  );
}

function PageContent({
  symbols,
  icons,
  notice,
  unavailableReasons,
  markets,
}: {
  symbols: string[];
  icons: Record<string, string>;
  notice: AccessNoticeSpec | null;
  unavailableReasons: Record<string, string>;
  markets: Record<string, QuoteMarket>;
}) {
  const t = useTranslations('instruments');
  return (
    <Section className="py-10 md:py-14">
      <Container>
        <div className="max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-tight text-primary sm:text-4xl lg:text-5xl">
            {t('title')}
          </h1>
          <p className="mt-3 text-secondary sm:text-lg">{t('subtitle')}</p>
        </div>

        <div className="mt-8 lg:mt-10">
          {notice ? (
            <AccessNotice
              state={notice.state}
              title={t(notice.titleKey)}
              text={t(notice.textKey)}
              reason={notice.reason}
              reasonLabel={notice.reason && t('accessReason', { reason: notice.reason })}
            />
          ) : (
            <InstrumentsBrowser
              symbols={symbols}
              icons={icons}
              unavailableReasons={unavailableReasons}
              markets={markets}
            />
          )}
        </div>
      </Container>
    </Section>
  );
}
