import { pageLocale } from '@/lib/locale';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Container, Section } from '@broker/ui';
import { StatusBoard } from '@/features/status/StatusBoard';
import { getCms } from '@/lib/cms';
import { brandName } from '@/lib/brand';
import { loadLiveStatus } from '@/lib/live-status';
import { resolveStatusView } from '@/features/status/view';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'status' });
  return {
    title: t('metaTitle'),
    description: t('metaDescription', { brand: await brandName(params.locale) }),
    robots: { index: false },
  };
}

export default async function StatusPage({ params }: PageProps) {
  setRequestLocale(params.locale);
  const t = await getTranslations('status');
  const { services, incidents } = await getCms('system-status', {
    locale: pageLocale(params.locale),
    revalidate: 60,
  });
  const view = resolveStatusView(services, await loadLiveStatus(), Date.now());

  return (
    <Section className="py-10 md:py-14">
      <Container className="max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight text-primary sm:text-4xl">
          {t('title')}
        </h1>
        <p className="mt-3 text-secondary">{t(view.mode === 'legacy' ? 'subtitle' : 'subtitleLive')}</p>
        <div className="mt-8">
          <StatusBoard view={view} incidents={incidents} />
        </div>
      </Container>
    </Section>
  );
}
