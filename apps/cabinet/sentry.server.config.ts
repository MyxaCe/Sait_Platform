import * as Sentry from '@sentry/nextjs';
import { scrubSentryEvent } from '@broker/api-client';
import { sentryEnvironment } from '@broker/utils';

/**
 * Серверный (Node) Sentry/GlitchTip кабинета — проект site-bff (DSN /2):
 * ошибки server actions / route handlers / RSC. Только ошибки; скраббинг до отправки.
 */
const dsn = process.env.SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: sentryEnvironment(process.env.SENTRY_ENV),
  tracesSampleRate: 0,
  sendDefaultPii: false,
  beforeSend: (event) =>
    scrubSentryEvent(event as unknown as Record<string, unknown>) as unknown as typeof event,
});
