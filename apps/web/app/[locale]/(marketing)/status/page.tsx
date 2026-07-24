import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Container, Section } from '@broker/ui';
import { StatusBoard } from '@/features/status/StatusBoard';
import { getCms } from '@/lib/cms';

interface PageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'status' });
  return { title: t('metaTitle'), description: t('metaDescription'), robots: { index: false } };
}

export default async function StatusPage({ params }: PageProps) {
  setRequestLocale(params.locale);
  const t = await getTranslations('status');
  // Статусы из CMS/status-сервиса (тег cms:system-status, revalidate 60 c);
  // строка quotes-ws подменяется live-состоянием на клиенте
  const { services, incidents } = await getCms('system-status', {
    locale: params.locale === 'en' ? 'en' : 'ru',
    revalidate: 60,
  });

  return (
    <Section className="py-10 md:py-14">
      <Container className="max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight text-primary sm:text-4xl">
          {t('title')}
        </h1>
        <p className="mt-3 text-secondary">{t('subtitle')}</p>
        <div className="mt-8">
          <StatusBoard services={services} incidents={incidents} />
        </div>
      </Container>
    </Section>
  );
}
