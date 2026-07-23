import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Button } from '@broker/ui';
import { Link } from '@/i18n/navigation';
import { getFaqSections } from '@/features/education/faq-data';

interface PageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'education' });
  return { title: t('faqMetaTitle'), description: t('faqMetaDescription') };
}

export default async function FaqPage({ params }: PageProps) {
  setRequestLocale(params.locale);
  const t = await getTranslations('education');
  const sections = getFaqSections(params.locale);

  // Микроразметка FAQPage: вопросы попадают в расширенные сниппеты поиска
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: sections.flatMap((s) =>
      s.items.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: { '@type': 'Answer', text: item.answer },
      })),
    ),
  };

  return (
    <div className="mx-auto max-w-3xl">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="space-y-10">
        {sections.map((section) => (
          <section key={section.title} aria-label={section.title}>
            <h2 className="text-xl font-semibold text-primary">{section.title}</h2>
            <div className="mt-4 space-y-3">
              {section.items.map((item) => (
                // Нативный details: доступно с клавиатуры, работает без JS
                <details
                  key={item.question}
                  className="group rounded-2xl border border-border bg-card open:border-accent/40"
                >
                  <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-medium text-primary [&::-webkit-details-marker]:hidden">
                    {item.question}
                    <svg
                      aria-hidden
                      viewBox="0 0 12 12"
                      className="size-3 shrink-0 fill-none stroke-secondary transition-transform duration-200 group-open:rotate-45"
                    >
                      <path d="M6 1v10M1 6h10" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </summary>
                  <p className="border-t border-border px-5 py-4 text-sm leading-relaxed text-secondary">
                    {item.answer}
                  </p>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-12 rounded-2xl border border-border bg-card p-6 text-center">
        <p className="font-medium text-primary">{t('faqNotFoundTitle')}</p>
        <p className="mt-1 text-sm text-secondary">{t('faqNotFoundText')}</p>
        <Link href="/company/contacts" className="mt-4 inline-block">
          <Button variant="secondary" tabIndex={-1}>
            {t('faqContact')}
          </Button>
        </Link>
      </div>
    </div>
  );
}
