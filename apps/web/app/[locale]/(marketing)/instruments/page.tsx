import type { Metadata } from 'next';
import { useTranslations } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Container, Section } from '@broker/ui';
import { InstrumentsBrowser } from '@/features/instruments/InstrumentsBrowser';
import { getCms } from '@/lib/cms';
import { getMdsIcons } from '@/lib/mds';
import { getTenantAllowList } from '@/lib/tenant';

interface PageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'instruments' });
  return { title: t('title'), description: t('metaDescription') };
}

export default async function InstrumentsPage({ params }: PageProps) {
  setRequestLocale(params.locale);
  // Контент страницы ∩ ДОСТУП сайта (allow-list карточки сайта, ADR-028)
  const [{ items: pageItems }, allowList] = await Promise.all([
    getCms('instruments', { locale: params.locale === 'en' ? 'en' : 'ru' }),
    getTenantAllowList(),
  ]);
  const items = pageItems.filter((i) => !allowList || allowList.has(i.symbol));

  // Иконки: загруженная в CMS приоритетнее, иначе — иконка монеты из MDS
  const mdsIcons = await getMdsIcons();
  const icons: Record<string, string> = {};
  for (const item of items) {
    const url = item.icon?.url ?? mdsIcons[item.symbol];
    if (url) icons[item.symbol] = url;
  }

  return <PageContent symbols={items.map((i) => i.symbol)} icons={icons} />;
}

function PageContent({ symbols, icons }: { symbols: string[]; icons: Record<string, string> }) {
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
          <InstrumentsBrowser symbols={symbols} icons={icons} />
        </div>
      </Container>
    </Section>
  );
}
