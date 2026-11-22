import * as Sentry from '@sentry/nextjs';
import { assertTenantSlugAtStartup } from '@broker/tenant';

function assertTenantKnown(): void {
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  try {
    const slug = assertTenantSlugAtStartup('старт web');
    console.info(`[web] тенант: ${slug}`);
  } catch (error) {
    console.error(`[web] ${(error as Error).message}`);
    process.exit(1);
  }
}

export async function register() {
  assertTenantKnown();

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
