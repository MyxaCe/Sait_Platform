import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { RegisterForm } from '@/features/registration/RegisterForm';

interface PageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'auth' });
  return { title: t('registerMetaTitle'), description: t('registerMetaDescription') };
}

interface Step {
  title: string;
  text: string;
}

export default async function RegisterPage({ params }: PageProps) {
  setRequestLocale(params.locale);
  const t = await getTranslations('auth');
  const steps = t.raw('steps') as Step[];

  return (
    <div className="grid w-full max-w-5xl gap-10 lg:grid-cols-[1fr_480px] lg:gap-16">
      {/* Левая колонка — только desktop: снимает возражения, не мешает на mobile */}
      <div className="hidden lg:block">
        <h1 className="text-4xl font-semibold leading-tight tracking-tight text-primary">
          {t.rich('registerTitle', {
            accent: (chunks) => <span className="text-accent">{chunks}</span>,
          })}
        </h1>
        <p className="mt-4 text-lg text-secondary">{t('registerSubtitle')}</p>
        <ol className="mt-10 space-y-6">
          {steps.map((step, i) => (
            <li key={step.title} className="flex gap-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-full border border-accent/40 bg-accent/10 font-semibold text-accent">
                {i + 1}
              </span>
              <div>
                <h2 className="font-semibold text-primary">{step.title}</h2>
                <p className="mt-1 text-sm text-secondary">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-10 rounded-2xl border border-border bg-card p-4 text-xs leading-relaxed text-secondary">
          {t('trust')}
        </p>
      </div>

      <div>
        <h1 className="mb-6 text-2xl font-semibold tracking-tight text-primary lg:hidden">
          {t('registerTitleShort')}
        </h1>
        <div className="rounded-3xl border border-border bg-card p-6 sm:p-8">
          <RegisterForm />
        </div>
      </div>
    </div>
  );
}
