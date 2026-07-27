import * as Sentry from '@sentry/node';
import { Pool } from 'pg';
import { eventEnvelopeSchema, scrubSentryEvent } from '@broker/api-client';
import { nextDelayMs } from './backoff';
import { createPublisher } from './publisher';

// GlitchTip (site-bff /2): ошибки воркера. Без DSN — выключен. Скраббинг до отправки.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENV ?? 'test',
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: (event) =>
      scrubSentryEvent(event as unknown as Record<string, unknown>) as unknown as typeof event,
  });
}

/**
 * Релей outbox → шина платформы (ADR-018).
 * SELECT ... FOR UPDATE SKIP LOCKED: безопасен при нескольких инстансах.
 * Доставка at-least-once: упали между publish и UPDATE → событие уйдёт
 * повторно; потребители дедуплицируют по event_id (контракт платформы).
 */

const POLL_INTERVAL_MS = 1_000;
const BATCH_SIZE = 20;

interface OutboxRow {
  id: string;
  event_id: string;
  routing_key: string;
  payload: unknown;
  attempts: number;
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('[relay] DATABASE_URL is required');
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl, max: 3 });
const publisher = createPublisher();
let running = true;

async function processBatch(): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<OutboxRow>(
      `SELECT id, event_id, routing_key, payload, attempts
         FROM outbox
        WHERE published_at IS NULL AND next_attempt_at <= now()
        ORDER BY id
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [BATCH_SIZE],
    );

    for (const row of rows) {
      try {
        const envelope = eventEnvelopeSchema.parse(row.payload);
        await publisher.publish(row.routing_key, envelope);
        await client.query(`UPDATE outbox SET published_at = now() WHERE id = $1`, [row.id]);
      } catch (error) {
        const attempts = row.attempts + 1;
        const delay = nextDelayMs(attempts);
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `[relay] publish failed event_id=${row.event_id} attempt=${attempts} retry_in=${delay}ms: ${message}`,
        );
        Sentry.captureException(error, { tags: { component: 'relay', routing_key: row.routing_key } });
        await client.query(
          `UPDATE outbox
              SET attempts = $2,
                  next_attempt_at = now() + ($3 || ' milliseconds')::interval,
                  last_error = $4
            WHERE id = $1`,
          [row.id, attempts, String(delay), message.slice(0, 500)],
        );
      }
    }

    await client.query('COMMIT');
    return rows.length;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  console.info('[relay] started (poll every %dms, batch %d)', POLL_INTERVAL_MS, BATCH_SIZE);
  while (running) {
    try {
      const processed = await processBatch();
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
