import type { Metadata } from 'next';
import { useTranslations } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Container, Section } from '@broker/ui';
import { InstrumentsBrowser } from '@/features/instruments/InstrumentsBrowser';
import { getCms } from '@/lib/cms';

interface PageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'instruments' });
  return { title: t('title'), description: t('metaDescription') };
}

export default async function InstrumentsPage({ params }: PageProps) {
  setRequestLocale(params.locale);
  // Allow-list из CMS (тег cms:instruments): показываем только разрешённые
  const { items } = await getCms('instruments', {
    locale: params.locale === 'en' ? 'en' : 'ru',
  });
  return <PageContent symbols={items.map((i) => i.symbol)} />;
}

function PageContent({ symbols }: { symbols: string[] }) {
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
          <InstrumentsBrowser symbols={symbols} />
        </div>
      </Container>
    </Section>
  );
}
