import * as Sentry from '@sentry/nextjs';
import { scrubSentryEvent } from '@broker/api-client';

/**
 * Клиентский (браузерный) Sentry/GlitchTip — проект site-web (DSN /1).
 * Только ошибки (tracesSampleRate 0, ADR-014); PII-скраббинг ДО отправки
 * через общий адаптер политики. Без DSN — выключен (dev/локально).
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.NEXT_PUBLIC_SENTRY_ENV ?? 'test',
  tracesSampleRate: 0,
  sendDefaultPii: false,
  beforeSend: (event) =>
    scrubSentryEvent(event as unknown as Record<string, unknown>) as unknown as typeof event,
});
