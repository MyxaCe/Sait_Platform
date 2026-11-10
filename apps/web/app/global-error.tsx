'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

/**
 * Верхняя граница ошибок App Router: репортит render-ошибки React в
 * GlitchTip (рекомендация @sentry/nextjs). Скраббинг — в beforeSend.
 *
 * Сюда же попадает отказ корневого layout: без бренда из CMS (и без
 * сохранённой версии) у страницы нет даже шапки. Тексты — UI, без бренда
 * и без контента: честное «временно недоступно» (решение 10.11).
 */
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
