'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Button } from '@broker/ui';

/**
 * 404 внутри локали: обязателен при route-сегменте [locale] —
 * без него notFound() в production отдаёт 500 вместо 404.
 */
export default function NotFound() {
  const t = useTranslations('notFound');

  return (
    <div className="flex min-h-svh flex-col items-center justify-center px-4 text-center">
      <p className="text-7xl font-bold text-accent">404</p>
      <h1 className="mt-4 text-2xl font-semibold text-primary">
        {t('title')}
      </h1>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-secondary">
        {t('text')}
      </p>
      <Link href="/" className="mt-8">
        <Button variant="secondary" tabIndex={-1}>
          {t('back')}
        </Button>
      </Link>
    </div>
  );
}
