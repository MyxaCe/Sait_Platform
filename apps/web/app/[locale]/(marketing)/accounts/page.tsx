import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Container, PricingTable, Section, type AccountPlan } from '@broker/ui';
import { CtaBand } from '@/components/home/CtaBand';
import { CommissionCalculator } from '@/features/accounts/CommissionCalculator';
import { getCms } from '@/lib/cms';

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

  // Тарифы из CMS (тег cms:accounts): таблица и калькулятор питаются
  // одним ответом — расчёты не разойдутся с витриной
  const { items } = await getCms('accounts', {
    locale: params.locale === 'en' ? 'en' : 'ru',
  });
  const plans: AccountPlan[] = items.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    minDeposit: p.minDeposit,
    featured: p.featured,
    features: p.features,
    ctaHref: `/register?account=${p.id}`,
  }));
  const pricing = items.map((p) => ({ id: p.id, name: p.name, ...p.pricing }));

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
            <CommissionCalculator pricing={pricing} />
          </div>
        </Container>
      </Section>

      <CtaBand />
    </>
  );
}
