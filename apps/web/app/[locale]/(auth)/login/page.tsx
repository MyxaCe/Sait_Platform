import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Button } from '@broker/ui';
import { Link } from '@/i18n/navigation';

interface PageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'auth' });
  return { title: t('loginMetaTitle'), robots: { index: false } };
}

export default async function LoginPage({ params }: PageProps) {
  setRequestLocale(params.locale);
  const t = await getTranslations('auth');
  const tCommon = await getTranslations('common');

  return (
    <div className="w-full max-w-md">
      <div className="rounded-3xl border border-border bg-card p-6 text-center sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-primary">{t('loginTitle')}</h1>
        <p className="mt-3 text-sm leading-relaxed text-secondary">{t('loginText')}</p>
        <Link href="/register" className="mt-6 inline-block w-full">
          <Button size="lg" className="w-full" tabIndex={-1}>
            {tCommon('openAccount')}
          </Button>
        </Link>
      </div>
    </div>
  );
}
