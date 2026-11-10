import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Badge, Button, Container, Section } from '@broker/ui';
import { Link } from '@/i18n/navigation';
import { brandName } from '@/lib/brand';

interface PageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'about' });
  return {
    title: t('metaTitle'),
    description: t('metaDescription', { brand: await brandName(params.locale) }),
  };
}

interface TimelineItem {
  year: string;
  text: string;
}
interface ValueItem {
  title: string;
  text: string;
}
interface FactItem {
  value: string;
  label: string;
}
/**
 * Раньше здесь был блок «Лицензии и регуляция» с CySEC/FSCA/FSA и
 * номерами-заглушками, а выше — «17 лет на рынке · 1.2 млн трейдеров ·
 * 87 млрд $». Лицензий и такой истории у площадки нет; на показе
 * комплаенсу это прямое ложное заявление. Теперь блок говорит о мерах
 * защиты, которые реально работают в продукте, а таймлайн — о том, как
 * устроена платформа, а не о выдуманной истории компании.
 */
interface SafeguardItem {
  title: string;
  text: string;
}

export default async function AboutPage({ params }: PageProps) {
  setRequestLocale(params.locale);
  const t = await getTranslations('about');
  const timeline = t.raw('timeline') as TimelineItem[];
  const values = t.raw('values') as ValueItem[];
  const facts = t.raw('facts') as FactItem[];
  const safeguards = t.raw('safeguards') as SafeguardItem[];

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
            {facts.map((fact) => (
              <div key={fact.value} className="flex flex-col gap-1">
                <dt className="order-2 text-sm text-secondary">{fact.label}</dt>
                <dd className="order-1 text-2xl font-semibold text-primary sm:text-3xl">
                  {fact.value}
                </dd>
              </div>
            ))}
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
                {t('safetyTitle')}
              </h2>
              <p className="mt-4 leading-relaxed text-secondary">{t('safetyText')}</p>
              <Link href="/legal/risk-disclosure" className="mt-6 inline-block">
                <Button variant="secondary" tabIndex={-1}>
                  {t('riskCta')}
                </Button>
              </Link>
            </div>
            <div className="space-y-4">
              {safeguards.map((item) => (
                <div key={item.title} className="rounded-2xl border border-border bg-card p-5">
                  <p className="font-semibold text-primary">{item.title}</p>
                  <p className="mt-0.5 text-sm text-secondary">{item.text}</p>
                </div>
              ))}
            </div>
          </div>
        </Container>
      </Section>
    </>
  );
}
