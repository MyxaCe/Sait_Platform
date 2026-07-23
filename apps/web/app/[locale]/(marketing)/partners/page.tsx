import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Badge, Button, Container, Section } from '@broker/ui';
import { Link } from '@/i18n/navigation';

interface PageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'partners' });
  return { title: t('metaTitle'), description: t('metaDescription') };
}

interface Model {
  name: string;
  description: string;
  features: string[];
}
interface Tier {
  name: string;
  clients: string;
  share: string;
  featured?: boolean;
}
interface Step {
  title: string;
  text: string;
}

export default async function PartnersPage({ params }: PageProps) {
  setRequestLocale(params.locale);
  const t = await getTranslations('partners');
  const models = t.raw('models') as Model[];
  const tiers = t.raw('tiers') as Tier[];
  const steps = t.raw('steps') as Step[];

  return (
    <>
      <Section className="py-10 md:py-14">
        <Container>
          <div className="max-w-2xl">
            <Badge className="mb-5">{t('badge')}</Badge>
            <h1 className="text-3xl font-semibold tracking-tight text-primary sm:text-4xl lg:text-5xl">
              {t('title')}
            </h1>
            <p className="mt-4 text-secondary sm:text-lg">{t('subtitle')}</p>
          </div>

          <div className="mt-10 grid gap-4 lg:grid-cols-2 lg:gap-6">
            {models.map((model) => (
              <article
                key={model.name}
                className="flex flex-col rounded-3xl border border-border bg-card p-6 lg:p-8"
              >
                <h2 className="text-xl font-semibold text-primary">{model.name}</h2>
                <p className="mt-3 leading-relaxed text-secondary">{model.description}</p>
                <ul className="mt-6 flex-1 space-y-3">
                  {model.features.map((f) => (
                    <li key={f} className="flex items-start gap-3 text-sm text-secondary">
                      <svg
                        viewBox="0 0 24 24"
                        className="mt-0.5 size-4 shrink-0 fill-none stroke-accent"
                        aria-hidden
                      >
                        <path d="M5 13l4 4L19 7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </Container>
      </Section>

      <Section className="border-t border-border bg-elevated/50">
        <Container>
          <h2 className="text-2xl font-semibold tracking-tight text-primary sm:text-3xl lg:text-4xl">
            {t('tiersTitle')}
          </h2>
          <p className="mt-3 max-w-2xl text-secondary">{t('tiersSubtitle')}</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3 lg:gap-6">
            {tiers.map((tier) => (
              <div
                key={tier.name}
                className={
                  tier.featured
                    ? 'relative rounded-2xl border border-accent bg-accent/5 p-6 lg:p-8'
                    : 'rounded-2xl border border-border bg-card p-6 lg:p-8'
                }
              >
                {tier.featured && (
                  <span className="absolute -top-3 left-6 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-base">
                    {t('tierMax')}
                  </span>
                )}
                <h3 className="font-semibold text-primary">{tier.name}</h3>
                <p className="mt-4 text-4xl font-bold text-accent">{tier.share}</p>
                <p className="mt-1 text-sm text-secondary">{t('fromSpread')}</p>
                <p className="mt-4 border-t border-border pt-4 text-sm text-secondary">
                  {tier.clients}
                </p>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      <Section>
        <Container>
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-primary sm:text-3xl lg:text-4xl">
                {t('howTitle')}
              </h2>
              <ol className="mt-8 space-y-6">
                {steps.map((step, i) => (
                  <li key={step.title} className="flex gap-4">
                    <span className="grid size-10 shrink-0 place-items-center rounded-full border border-accent/40 bg-accent/10 font-semibold text-accent">
                      {i + 1}
                    </span>
                    <div>
                      <h3 className="font-semibold text-primary">{step.title}</h3>
                      <p className="mt-1 text-sm text-secondary">{step.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <div className="rounded-3xl border border-accent/20 bg-gradient-to-br from-royal/40 via-card to-card p-8 text-center lg:p-12">
              <h3 className="text-xl font-semibold text-primary">{t('ctaTitle')}</h3>
              <p className="mt-3 text-sm leading-relaxed text-secondary">{t('ctaText')}</p>
              <Link href="/company/contacts?topic=partnership" className="mt-6 inline-block w-full sm:w-auto">
                <Button size="lg" className="w-full sm:px-10" tabIndex={-1}>
                  {t('ctaButton')}
                </Button>
              </Link>
            </div>
          </div>
        </Container>
      </Section>
    </>
  );
}
