import * as Sentry from '@sentry/nextjs';

/**
 * Next instrumentation hook: инициализирует серверный/edge Sentry по рантайму.
 * Клиентский — из sentry.client.config.ts (подключает withSentryConfig).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Захват ошибок вложенных RSC/route handlers (Next 14.2+/@sentry v8)
export const onRequestError = Sentry.captureRequestError;
