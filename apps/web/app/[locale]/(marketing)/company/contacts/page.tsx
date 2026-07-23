import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Container, Section } from '@broker/ui';
import { ContactForm } from '@/features/contacts/ContactForm';

interface PageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'contacts' });
  return { title: t('metaTitle'), description: t('metaDescription') };
}

interface Channel {
  title: string;
  value: string;
  detail: string;
}
interface Office {
  city: string;
  country: string;
  address: string;
}

export default async function ContactsPage({ params }: PageProps) {
  setRequestLocale(params.locale);
  const t = await getTranslations('contacts');
  const channels = t.raw('channels') as Channel[];
  const offices = t.raw('officesList') as Office[];

  return (
    <Section className="py-10 md:py-14">
      <Container>
        <div className="max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-tight text-primary sm:text-4xl lg:text-5xl">
            {t('title')}
          </h1>
          <p className="mt-3 text-secondary sm:text-lg">{t('subtitle')}</p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-3 lg:gap-6">
          {channels.map((ch) => (
            <div key={ch.title} className="rounded-2xl border border-border bg-card p-6">
              <h2 className="text-sm text-secondary">{ch.title}</h2>
              <p className="mt-2 font-semibold text-primary">{ch.value}</p>
              <p className="mt-2 text-xs leading-relaxed text-secondary">{ch.detail}</p>
            </div>
          ))}
        </div>

        <div className="mt-14 grid gap-10 lg:grid-cols-[1fr_420px] lg:gap-16">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-primary sm:text-3xl">
              {t('writeUs')}
            </h2>
            <p className="mt-2 text-secondary">{t('writeUsText')}</p>
            <div className="mt-6">
              <ContactForm />
            </div>
          </div>

          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-primary sm:text-3xl">
              {t('offices')}
            </h2>
            <div className="mt-6 space-y-4">
              {offices.map((office) => (
                <div key={office.city} className="rounded-2xl border border-border bg-card p-5">
                  <p className="font-semibold text-primary">{office.city}</p>
                  <p className="mt-0.5 text-xs text-accent">{office.country}</p>
                  <p className="mt-2 text-sm text-secondary">{office.address}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}
