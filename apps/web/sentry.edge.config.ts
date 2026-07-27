import * as Sentry from '@sentry/nextjs';
import { scrubSentryEvent } from '@broker/api-client';

/**
 * Edge-рантайм (middleware) Sentry/GlitchTip — тот же проект site-bff.
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
