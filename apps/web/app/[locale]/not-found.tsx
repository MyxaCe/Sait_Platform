'use client';

import { useLocale } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Button } from '@broker/ui';

/**
 * 404 внутри локали: обязателен при route-сегменте [locale] —
 * без него notFound() в production отдаёт 500 вместо 404.
 */
export default function NotFound() {
  const locale = useLocale();
  const en = locale === 'en';

  return (
    <div className="flex min-h-svh flex-col items-center justify-center px-4 text-center">
      <p className="text-7xl font-bold text-accent">404</p>
      <h1 className="mt-4 text-2xl font-semibold text-primary">
        {en ? 'Page not found' : 'Страница не найдена'}
      </h1>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-secondary">
        {en
          ? 'The page may have been moved or never existed. Check the address or start from the home page.'
          : 'Возможно, страница была перемещена или никогда не существовала. Проверьте адрес или начните с главной.'}
      </p>
      <Link href="/" className="mt-8">
        <Button variant="secondary" tabIndex={-1}>
          {en ? 'Back to home' : 'Вернуться на главную'}
        </Button>
      </Link>
    </div>
  );
}
