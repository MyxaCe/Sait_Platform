import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Container, PricingTable, Section } from '@broker/ui';
import { CtaBand } from '@/components/home/CtaBand';
import { CommissionCalculator } from '@/features/accounts/CommissionCalculator';
import { getAccountPlans } from '@/features/accounts/plans';

interface PageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'accounts' });
  return { title: t('title'), description: t('metaDescription') };
}

export default async function AccountsPage({ params }: PageProps) {
  setRequestLocale(params.locale);
  const t = await getTranslations('accounts');
  const plans = getAccountPlans(params.locale);

  return (
    <>
      <Section className="py-10 md:py-14">
        <Container>
          <div className="max-w-2xl">
            <h1 className="text-3xl font-semibold tracking-tight text-primary sm:text-4xl lg:text-5xl">
              {t('title')}
            </h1>
            <p className="mt-3 text-secondary sm:text-lg">{t('subtitle')}</p>
          </div>

          <PricingTable
            plans={plans}
            labels={{
              popular: t('table.popular'),
              popularChoice: t('table.popularChoice'),
              terms: t('table.terms'),
              minDeposit: t('table.minDeposit'),
              from: t('table.from'),
              deposit: t('table.deposit'),
              defaultCta: t('table.openCta'),
            }}
            className="mt-10 lg:mt-14"
          />
        </Container>
      </Section>

      <Section className="border-t border-border bg-elevated/50">
        <Container>
          <div className="max-w-2xl">
            <h2 className="text-2xl font-semibold tracking-tight text-primary sm:text-3xl lg:text-4xl">
              {t('calcTitle')}
            </h2>
            <p className="mt-3 text-secondary">{t('calcSubtitle')}</p>
          </div>

          <div className="mt-8 lg:mt-10">
            <CommissionCalculator />
          </div>
        </Container>
      </Section>

      <CtaBand />
    </>
  );
}
