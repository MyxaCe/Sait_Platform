import * as Sentry from '@sentry/node';
import { Pool } from 'pg';
import { scrubSentryEvent } from '@broker/api-client';
import { readEnv, sentryEnvironment } from '@broker/utils';
import { BATCH_SIZE, POLL_INTERVAL_MS, processBatch } from './outbox';
import { createPublisher } from './publisher';

const sentryDsn = readEnv(process.env.SENTRY_DSN);
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: sentryEnvironment(process.env.SENTRY_ENV),
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: (event) =>
      scrubSentryEvent(event as unknown as Record<string, unknown>) as unknown as typeof event,
  });
}

const databaseUrl = readEnv(process.env.DATABASE_URL);
if (!databaseUrl) {
  console.error('[relay] DATABASE_URL is required');
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl, max: 3 });
const publisher = createPublisher();
let running = true;

async function runBatch(): Promise<number> {
  const client = await pool.connect();
  try {
    return await processBatch(client, publisher, {
      onPublishError: (error, row) =>
        Sentry.captureException(error, {
          tags: { component: 'relay', routing_key: row.routing_key },
        }),
    });
  } finally {
    client.release();
  }
}

async function main() {
  console.info('[relay] started (poll every %dms, batch %d)', POLL_INTERVAL_MS, BATCH_SIZE);
  while (running) {
    try {
      const processed = await runBatch();
      if (processed === 0) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
    } catch (error) {
      console.error('[relay] batch error:', error);
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS * 5));
    }
  }
  await publisher.close();
  await pool.end();
  console.info('[relay] stopped');
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.info(`[relay] ${signal} received, shutting down...`);
    running = false;
  });
}

void main();
