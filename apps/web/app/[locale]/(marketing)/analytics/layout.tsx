import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { pageLocale } from '@/lib/locale';
import { emptySections } from '@/lib/empty-sections';
import { Container } from '@broker/ui';
import { AnalyticsTabs } from '@/components/analytics/AnalyticsTabs';

interface LayoutProps {
  children: React.ReactNode;
  params: { locale: string };
}

export default async function AnalyticsLayout({ children, params }: LayoutProps) {
  setRequestLocale(params.locale);
  const empty = await emptySections(pageLocale(params.locale));
  return <LayoutContent hidden={[...empty]}>{children}</LayoutContent>;
}

function LayoutContent({ children, hidden }: { children: React.ReactNode; hidden: string[] }) {
  const t = useTranslations('analytics');
  return (
    <div className="py-10 md:py-14">
      <Container>
        <h1 className="text-3xl font-semibold tracking-tight text-primary sm:text-4xl lg:text-5xl">
          {t('title')}
        </h1>
        <p className="mt-3 max-w-2xl text-secondary sm:text-lg">{t('subtitle')}</p>
        <div className="mt-8">
          <AnalyticsTabs hidden={hidden} />
        </div>
        <div className="mt-8">{children}</div>
      </Container>
    </div>
  );
}
