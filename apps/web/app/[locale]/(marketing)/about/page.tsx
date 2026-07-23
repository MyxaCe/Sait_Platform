import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Badge, Button, Container, Section, StatCounter } from '@broker/ui';
import { Link } from '@/i18n/navigation';

interface PageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'about' });
  return { title: t('metaTitle'), description: t('metaDescription') };
}

interface TimelineItem {
  year: string;
  text: string;
}
interface ValueItem {
  title: string;
  text: string;
}
interface LicenseItem {
  authority: string;
  region: string;
  number: string;
}

export default async function AboutPage({ params }: PageProps) {
  setRequestLocale(params.locale);
  const t = await getTranslations('about');
  const timeline = t.raw('timeline') as TimelineItem[];
  const values = t.raw('values') as ValueItem[];
  const licenses = t.raw('licenses') as LicenseItem[];

  return (
    <>
      <Section className="py-10 md:py-14">
        <Container>
          <div className="max-w-3xl">
            <Badge className="mb-5">{t('badge')}</Badge>
            <h1 className="text-3xl font-semibold tracking-tight text-primary sm:text-4xl lg:text-5xl">
              {t.rich('title', {
                accent: (chunks) => <span className="text-accent">{chunks}</span>,
              })}
            </h1>
            <p className="mt-5 text-secondary sm:text-lg">{t('subtitle')}</p>
          </div>

          <dl className="mt-12 grid grid-cols-2 gap-x-6 gap-y-8 border-t border-border pt-8 sm:grid-cols-4">
            <StatCounter value={17} suffix={t('statsYearsSuffix')} label={t('statsYears')} />
            <StatCounter value={1_240_000} label={t('statsTraders')} />
            <StatCounter value={87} suffix={t('statsVolumeSuffix')} label={t('statsVolume')} />
            <StatCounter value={190} suffix="+" label={t('statsCountries')} />
          </dl>
        </Container>
      </Section>

      <Section className="border-t border-border bg-elevated/50">
        <Container>
          <h2 className="text-2xl font-semibold tracking-tight text-primary sm:text-3xl lg:text-4xl">
            {t('historyTitle')}
          </h2>
          <ol className="mt-10 space-y-0">
            {timeline.map((item, i) => (
              <li key={item.year} className="relative flex gap-6 pb-10 last:pb-0">
                {/* Вертикальная линия таймлайна */}
                {i < timeline.length - 1 && (
                  <span
                    aria-hidden
                    className="absolute left-[27px] top-14 bottom-0 w-px bg-border"
                  />
                )}
                <span className="grid size-14 shrink-0 place-items-center rounded-2xl border border-accent/30 bg-accent/10 text-sm font-bold text-accent">
                  {item.year}
                </span>
                <p className="pt-3.5 leading-relaxed text-secondary">{item.text}</p>
              </li>
            ))}
          </ol>
        </Container>
      </Section>

      <Section>
        <Container>
          <h2 className="text-2xl font-semibold tracking-tight text-primary sm:text-3xl lg:text-4xl">
            {t('valuesTitle')}
          </h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3 lg:gap-6">
            {values.map((v) => (
              <div key={v.title} className="rounded-2xl border border-border bg-card p-6 lg:p-8">
                <h3 className="text-lg font-semibold text-accent">{v.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-secondary">{v.text}</p>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      <Section className="border-t border-border bg-elevated/50">
        <Container>
          <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-16">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-primary sm:text-3xl lg:text-4xl">
                {t('licensesTitle')}
              </h2>
              <p className="mt-4 leading-relaxed text-secondary">{t('licensesText')}</p>
              <Link href="/legal/risk-disclosure" className="mt-6 inline-block">
                <Button variant="secondary" tabIndex={-1}>
                  {t('riskCta')}
                </Button>
              </Link>
            </div>
            <div className="space-y-4">
              {licenses.map((lic) => (
                <div
                  key={lic.authority}
                  className="flex items-center justify-between rounded-2xl border border-border bg-card p-5"
                >
                  <div>
                    <p className="font-semibold text-primary">{lic.authority}</p>
                    <p className="mt-0.5 text-sm text-secondary">{lic.region}</p>
                  </div>
                  <span className="text-sm tabular-nums text-secondary">{lic.number}</span>
                </div>
              ))}
            </div>
          </div>
        </Container>
      </Section>
    </>
  );
}
