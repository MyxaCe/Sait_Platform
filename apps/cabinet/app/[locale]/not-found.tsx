import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Button } from '@broker/ui';

/** Свой not-found под [locale] обязателен (урок B-006). */
export default function NotFound() {
  const t = useTranslations('common');
  return (
    <main className="grid min-h-svh place-items-center px-4 text-center">
      <div>
        <p className="text-6xl font-bold text-accent">404</p>
        <h1 className="mt-4 text-xl font-semibold">{t('notFound')}</h1>
        <p className="mt-2 text-secondary">{t('notFoundHint')}</p>
        <Link href="/" className="mt-6 inline-block">
          <Button tabIndex={-1}>{t('toDashboard')}</Button>
        </Link>
      </div>
    </main>
  );
}
