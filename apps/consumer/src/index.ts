import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import * as Sentry from '@sentry/node';
import { Pool } from 'pg';
import { scrubSentryEvent } from '@broker/api-client';
import { readEnv, sentryEnvironment } from '@broker/utils';
import { assertSchemaCurrent } from '@broker/db';
import { applyTerminalEvent, classifyMessage } from './projection.js';
import { createSubscriber } from './subscriber.js';
import { assertTenantSlugAtStartup } from '@broker/tenant';

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
  console.error('[consumer] DATABASE_URL is required');
  process.exit(1);
}

let tenant: string;
try {
  tenant = assertTenantSlugAtStartup('старт консюмера');
} catch (error) {
  console.error(`[consumer] ${(error as Error).message}`);
  process.exit(1);
}
console.info(`[consumer] тенант: ${tenant}`);
const pool = new Pool({ connectionString: databaseUrl, max: 3 });

async function assertSchemaKnown(): Promise<void> {
  try {
    const state = await assertSchemaCurrent(pool as never);
    if (state.ahead.length > 0) {
      console.warn(`[consumer] схема опережает код: ${state.ahead.join(', ')}`);
    }
    console.info(`[consumer] схема: применено ${state.applied.length}`);
  } catch (error) {
    console.error(`[consumer] ${(error as Error).message}`);
    process.exit(1);
  }
}
const subscriber = createSubscriber((where, error) => {
  console.error(`[consumer] ${where} error: ${error.message} — подписка мертва, выходим`);
  Sentry.captureException(error, { tags: { component: 'consumer', kind: 'bus-fatal', where } });
  clearInterval(keepAlive);
  process.exitCode = 1;
  void subscriber.close().then(() => pool.end()).then(() => process.exit(1));
});

export const parseStats = { foreign: 0, malformed: 0, applied: 0 };

class MalformedMessageError extends Error {
  constructor(
    reason: string,
    readonly eventId: string | null,
  ) {
    super(`malformed message: ${reason}`);
    this.name = 'MalformedMessageError';
  }
}

async function handle(raw: unknown): Promise<void> {
  const message = classifyMessage(raw);

  if (message.kind === 'foreign') {
    parseStats.foreign += 1;
    console.debug(
      `[consumer] foreign event skipped: ${message.event} ${message.eventId} (foreign=${parseStats.foreign})`,
    );
    return;
  }

  if (message.kind === 'malformed') {
    parseStats.malformed += 1;
    console.warn(
      `[consumer] MALFORMED message → DLQ: ${message.reason} id=${message.eventId ?? '(no id)'} (malformed=${parseStats.malformed})`,
    );
    const error = new MalformedMessageError(message.reason, message.eventId);
    Sentry.captureException(error, {
      tags: { component: 'consumer', kind: 'malformed' },
      extra: { eventId: message.eventId, reason: message.reason },
    });
    throw error;
  }

  const { eventId, event } = message;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const outcome = await applyTerminalEvent(client, eventId, event, { tenant, newId: randomUUID });
    await client.query('COMMIT');
    if (outcome === 'applied') {
      parseStats.applied += 1;
      console.info(`[consumer] ${event.name} ${eventId} applied`);
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    Sentry.captureException(error, { tags: { component: 'consumer', event: event.name } });
    throw error;
  } finally {
    client.release();
  }
}

const keepAlive = setInterval(() => {}, 1 << 30);

async function main() {
  await assertSchemaKnown();
  await subscriber.start(handle);
  console.info(`[consumer] started (tenant=${tenant})`);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.info(`[consumer] ${signal} received, shutting down...`);
    clearInterval(keepAlive);
    void subscriber
      .close()
      .then(() => pool.end())
      .then(() => process.exit(0));
  });
}

void main();
