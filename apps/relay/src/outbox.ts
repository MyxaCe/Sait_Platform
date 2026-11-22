import { eventEnvelopeSchema } from '@broker/api-client';
import { nextDelayMs } from './backoff.js';
import type { Publisher } from './publisher.js';

export const POLL_INTERVAL_MS = 1_000;
export const BATCH_SIZE = 20;

export interface OutboxRow {
  id: string;
  event_id: string;
  routing_key: string;
  payload: unknown;
  attempts: number;
}

export interface Querier {
  query<R = unknown>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export interface ProcessBatchOptions {
  readonly onPublishError?: (error: unknown, row: OutboxRow) => void;
  readonly batchSize?: number;
}

export async function processBatch(
  client: Querier,
  publisher: Publisher,
  options: ProcessBatchOptions = {},
): Promise<number> {
  const { onPublishError, batchSize = BATCH_SIZE } = options;

  try {
    await client.query('BEGIN');
    const { rows } = await client.query<OutboxRow>(
      `SELECT id, event_id, routing_key, payload, attempts
         FROM outbox
        WHERE published_at IS NULL AND next_attempt_at <= now()
        ORDER BY id
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [batchSize],
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
        onPublishError?.(error, row);
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
  }
}
