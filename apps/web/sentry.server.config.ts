import * as Sentry from '@sentry/nextjs';
import { scrubSentryEvent } from '@broker/api-client';

/**
 * Серверный (Node) Sentry/GlitchTip — проект site-bff (DSN /2): ошибки
 * route handlers / RSC / BFF. Только ошибки; PII-скраббинг ДО отправки.
 */
const dsn = process.env.SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.SENTRY_ENV ?? 'test',
  tracesSampleRate: 0,
  sendDefaultPii: false,
  beforeSend: (event) =>
    scrubSentryEvent(event as unknown as Record<string, unknown>) as unknown as typeof event,
});
