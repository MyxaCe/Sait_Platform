import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Container, Section, cn } from '@broker/ui';
import { formatDate } from '@broker/utils';
import { Link } from '@/i18n/navigation';
import { findLegalDocument, LEGAL_SLUGS } from '@/features/legal/documents';
import { getCms } from '@/lib/cms';

interface PageParams {
  params: { locale: string; document: string };
}

export function generateStaticParams() {
  return LEGAL_SLUGS.map((document) => ({ document }));
}

export function generateMetadata({ params }: PageParams): Metadata {
  const doc = findLegalDocument(params.document, params.locale);
  if (!doc) return {};
  return { title: doc.title, description: doc.intro };
}

export default async function LegalDocumentPage({ params }: PageParams) {
  setRequestLocale(params.locale);

  // Контент из CMS-слоя (тег cms:legal, вебхук-инвалидация)
  const { items: documents } = await getCms('legal', {
    locale: params.locale === 'en' ? 'en' : 'ru',
  });
  const doc = documents.find((d) => d.slug === params.document);
  if (!doc) notFound();

  const t = await getTranslations('legal');
  const intlLocale = params.locale === 'en' ? 'en-US' : 'ru-RU';

  return (
    <Section className="py-10 md:py-14">
      <Container>
        <div className="grid gap-10 lg:grid-cols-[260px_1fr] lg:gap-16">
          {/* Навигация по документам */}
          <nav aria-label={t('navAria')} className="lg:sticky lg:top-24 lg:self-start">
            <h2 className="text-sm font-semibold text-primary">{t('navTitle')}</h2>
            <ul className="mt-3 flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0"
                style={{ scrollbarWidth: 'none' }}>
              {documents.map((d) => (
                <li key={d.slug} className="shrink-0">
                  <Link
                    href={`/legal/${d.slug}`}
                    aria-current={d.slug === doc.slug ? 'page' : undefined}
                    className={cn(
                      'block whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors lg:whitespace-normal',
                      d.slug === doc.slug
                        ? 'bg-accent/10 font-medium text-accent'
                        : 'text-secondary hover:bg-primary/5 hover:text-primary',
                    )}
                  >
                    {d.title}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <article className="max-w-3xl">
            <h1 className="text-3xl font-semibold tracking-tight text-primary sm:text-4xl">
              {doc.title}
            </h1>
            <p className="mt-2 text-sm text-secondary">
              {t('updated', { date: formatDate(doc.updatedAt, intlLocale) })}
            </p>
            <p className="mt-6 leading-relaxed text-secondary">{doc.intro}</p>

            <div className="mt-10 space-y-10">
              {doc.sections.map((section) => (
                <section key={section.heading}>
                  <h2 className="text-xl font-semibold text-primary">{section.heading}</h2>
                  <div className="mt-3 space-y-4">
                    {section.paragraphsMarkdown.map((p, i) => (
                      <p key={i} className="leading-relaxed text-primary/85">
                        {p}
                      </p>
                    ))}
                  </div>
                </section>
              ))}
            </div>

            <p className="mt-12 rounded-2xl border border-border bg-card p-5 text-sm leading-relaxed text-secondary">
              {t.rich('questions', {
                link: (chunks) => (
                  <Link href="/company/contacts" className="text-accent hover:underline">
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          </article>
        </div>
      </Container>
    </Section>
  );
}
