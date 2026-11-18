import * as Sentry from '@sentry/nextjs';
import { assertTenantSlugAtStartup } from '@broker/tenant';

function assertTenantKnown(): void {
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  try {
    const slug = assertTenantSlugAtStartup('старт cabinet');
    console.info(`[cabinet] тенант: ${slug}`);
  } catch (error) {
    console.error(`[cabinet] ${(error as Error).message}`);
    process.exit(1);
  }
}

export async function register() {
  assertTenantKnown();

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertSchemaKnown } = await import('./schema-gate');
    await assertSchemaKnown();

    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
