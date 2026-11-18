'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="ru">
      <head>
        <meta name="robots" content="noindex" />
      </head>
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
        <h2>Сайт временно недоступен</h2>
        <p>Мы уже знаем о проблеме. Попробуйте обновить страницу через пару минут.</p>
      </body>
    </html>
  );
}
