'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="ru">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
        <h2>Что-то пошло не так</h2>
        <p>Мы уже знаем о проблеме. Попробуйте обновить страницу.</p>
      </body>
    </html>
  );
}
