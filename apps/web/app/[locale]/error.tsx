'use client';

import * as Sentry from '@sentry/nextjs';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { Button } from '@broker/ui';

/**
 * Страница не собралась — почти всегда потому, что CMS недоступна и
 * сохранённой версии её ответа нет (`getCms` → `CmsUnavailableError`).
 *
 * Контента-заменителя здесь нет и быть не должно (решение 10.11): честное
 * «временно недоступно» вместо правдоподобного текста из кода. HTTP-код
 * 503 + `Retry-After` + `X-Robots-Tag: noindex` ставит `server-entry.cjs`
 * (из App Router страница сама код ответа не задаёт).
 */
export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('common');

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div
      className="flex min-h-[60svh] flex-col items-center justify-center px-4 text-center"
      data-testid="cms-unavailable"
    >
      <meta name="robots" content="noindex" />
      <h1 className="text-2xl font-semibold text-primary">{t('cmsUnavailableTitle')}</h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-secondary">
        {t('cmsUnavailableText')}
      </p>
      <Button variant="secondary" className="mt-8" onClick={() => reset()}>
        {t('retry')}
      </Button>
    </div>
  );
}
