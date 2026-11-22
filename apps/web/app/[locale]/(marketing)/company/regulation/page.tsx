import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Container, Section } from '@broker/ui';
import { RegulationDetails } from '@/features/legal/RegulationDetails';
import { getCms } from '@/lib/cms';
import { pageLocale } from '@/lib/locale';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'legalEntity' });
  return { title: t('title') };
}

export default async function RegulationPage({ params }: PageProps) {
  setRequestLocale(params.locale);
  const brand = await getCms('brand', { locale: pageLocale(params.locale) });
  if (!brand.legalEntity) notFound();
  const t = await getTranslations('legalEntity');

  return (
    <Section className="py-10 md:py-14">
      <Container>
        <div className="max-w-3xl">
          <h1 className="text-3xl font-semibold tracking-tight text-primary sm:text-4xl lg:text-5xl">
            {t('title')}
          </h1>
          <div className="mt-10">
            <RegulationDetails
              entity={brand.legalEntity}
              labels={{
                entityTitle: t('entityTitle'),
                name: t('name'),
                registrationNumber: t('registrationNumber'),
                address: t('address'),
                licensesTitle: t('licensesTitle'),
                licenseNumber: t('licenseNumberLabel'),
                activity: t('activity'),
                regulator: t('regulator'),
                regulatorCountry: t('regulatorCountry'),
                verifyLicense: t('verifyLicense'),
                document: t('document'),
              }}
            />
          </div>
        </div>
      </Container>
    </Section>
  );
}
