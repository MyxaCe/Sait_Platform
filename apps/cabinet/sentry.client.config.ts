import * as Sentry from '@sentry/nextjs';
import { scrubSentryEvent } from '@broker/api-client';
import { sentryEnvironment } from '@broker/utils';

/**
 * Клиентский (браузерный) Sentry/GlitchTip кабинета — проект site-web (DSN /1).
 * Только ошибки; PII-скраббинг ДО отправки. Без DSN — выключен.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: sentryEnvironment(process.env.NEXT_PUBLIC_SENTRY_ENV),
  tracesSampleRate: 0,
  sendDefaultPii: false,
  beforeSend: (event) =>
    scrubSentryEvent(event as unknown as Record<string, unknown>) as unknown as typeof event,
});
