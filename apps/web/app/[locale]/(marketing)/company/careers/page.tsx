import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Badge, Container, Section } from '@broker/ui';

interface PageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'careers' });
  return { title: t('metaTitle'), description: t('metaDescription') };
}

interface Benefit {
  title: string;
  text: string;
}
interface Vacancy {
  title: string;
  department: string;
  location: string;
  type: string;
}

const HR_EMAIL = 'hr@apexcapital.example';

export default async function CareersPage({ params }: PageProps) {
  setRequestLocale(params.locale);
  const t = await getTranslations('careers');
  const benefits = t.raw('benefits') as Benefit[];
  const vacancies = t.raw('vacancies') as Vacancy[];

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

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
            {benefits.map((b) => (
              <div key={b.title} className="rounded-2xl border border-border bg-card p-6">
                <h2 className="font-semibold text-accent">{b.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-secondary">{b.text}</p>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      <Section className="border-t border-border bg-elevated/50">
        <Container>
          <h2 className="text-2xl font-semibold tracking-tight text-primary sm:text-3xl lg:text-4xl">
            {t('vacanciesTitle')}
          </h2>
          <ul className="mt-8 divide-y divide-border overflow-hidden rounded-2xl border border-border">
            {vacancies.map((vacancy) => (
              <li key={vacancy.title} className="bg-card">
                <a
                  href={`mailto:${HR_EMAIL}?subject=${encodeURIComponent(t('applySubject', { title: vacancy.title }))}`}
                  className="group flex flex-col gap-3 px-5 py-5 transition-colors hover:bg-elevated/60 sm:flex-row sm:items-center sm:justify-between lg:px-8"
                >
                  <div>
                    <h3 className="font-semibold text-primary group-hover:text-accent">
                      {vacancy.title}
                    </h3>
                    <p className="mt-1 text-sm text-secondary">
                      {vacancy.department} · {vacancy.location} · {vacancy.type}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-medium text-accent">{t('apply')}</span>
                </a>
              </li>
            ))}
          </ul>

          <p className="mt-8 text-sm text-secondary">
            {t.rich('notFound', {
              email: () => (
                <a href={`mailto:${HR_EMAIL}`} className="text-accent hover:underline">
                  {HR_EMAIL}
                </a>
              ),
            })}
          </p>
        </Container>
      </Section>
    </>
  );
}
