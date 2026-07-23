import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Button } from '@broker/ui';
import { Link } from '@/i18n/navigation';

interface PageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'offline' });
  return { title: t('metaTitle'), robots: { index: false } };
}

export default async function OfflinePage({ params }: PageProps) {
  setRequestLocale(params.locale);
  const t = await getTranslations('offline');

  return (
    <div className="flex min-h-svh flex-col items-center justify-center px-4 text-center">
      <div className="grid size-16 place-items-center rounded-full border border-border bg-card">
        <svg viewBox="0 0 24 24" className="size-8 fill-none stroke-secondary" aria-hidden>
          <path
            d="M1 1l22 22M8.5 16.5a5 5 0 017 0M5 12.5a10 10 0 014.7-2.6M12 4c3.5 0 6.7 1.4 9 3.7l-2.1 2.1"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="20" r="1.2" className="fill-secondary" />
        </svg>
      </div>
      <h1 className="mt-6 text-2xl font-semibold text-primary">{t('title')}</h1>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-secondary">{t('text')}</p>
      <Link href="/" className="mt-8">
        <Button variant="secondary" tabIndex={-1}>
          {t('retry')}
        </Button>
      </Link>
    </div>
  );
}
