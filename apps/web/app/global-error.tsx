'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect, useState } from 'react';
import { FATAL_ERROR_TEXTS, detectFatalErrorLocale, type FatalErrorLocale } from '@broker/utils/fatal-error';

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  const [locale, setLocale] = useState<FatalErrorLocale>('ru');
  useEffect(() => {
    Sentry.captureException(error);
    setLocale(detectFatalErrorLocale());
  }, [error]);
  const t = FATAL_ERROR_TEXTS.site[locale];

  return (
    <html lang={locale}>
      <head>
        <meta name="robots" content="noindex" />
      </head>
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', lineHeight: 1.5 }}>
        <h2>{t.title}</h2>
        <p>{t.body}</p>
        <button type="button" onClick={() => window.location.reload()} style={{ marginTop: '1rem', padding: '0.5rem 1rem', cursor: 'pointer' }}>
          {t.retry}
        </button>
      </body>
    </html>
  );
}
