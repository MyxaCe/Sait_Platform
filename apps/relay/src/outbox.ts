import { eventEnvelopeSchema } from '@broker/api-client';
import { nextDelayMs } from './backoff.js';
import type { Publisher } from './publisher.js';

/**
 * Пер-строчная логика повторов outbox → шина (ADR-018).
 *
 * **Почему это отдельный модуль, а не тело `index.ts`.** REL-04: отказ
 * публикации обязан быть виден не только в логе процесса, но и в
 * СОСТОЯНИИ СТРОКИ — `attempts` и `last_error`. Проверить это можно
 * только на связке «издатель отказал → что лежит в outbox», а покрытие
 * единицы покрытием пути не является: у `publisher.test.ts` отказ
 * виден, а строка ему не видна вовсе. Пока цикл жил внутри `index.ts`,
 * который при импорте поднимает пул Postgres и запускает `main()`,
 * такой проверки не существовало — и именно в этом зазоре дефект
 * прожил.
 *
 * Сюда вынесена ровно прежняя логика, без изменений поведения: тот же
 * SQL, та же транзакция, тот же backoff. Трекер ошибок остался в
 * `index.ts` и приходит параметром — модуль не должен тянуть Sentry
 * ради теста.
 */

export const POLL_INTERVAL_MS = 1_000;
export const BATCH_SIZE = 20;

export interface OutboxRow {
  id: string;
  event_id: string;
  routing_key: string;
  payload: unknown;
  attempts: number;
}

/** Минимум от pg-клиента: в проде — `PoolClient`, в тестах — двойник. */
export interface Querier {
  query<R = unknown>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export interface ProcessBatchOptions {
  /** Трекер ошибок. Инъекцией — чтобы модуль не зависел от Sentry. */
  readonly onPublishError?: (error: unknown, row: OutboxRow) => void;
  readonly batchSize?: number;
}

/**
 * Обработать одну пачку. Возвращает число взятых строк.
 *
 * SELECT ... FOR UPDATE SKIP LOCKED: безопасен при нескольких инстансах.
 * Доставка at-least-once: упали между publish и UPDATE → событие уйдёт
 * повторно; потребители дедуплицируют по event_id (контракт платформы).
 */
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
        // ВТОРОЕ из двух мест, где обязан быть виден отказ. Первое — лог
        // процесса, и оно работало всегда; строка outbox не получала
        // ничего, потому что процесс умирал раньше (REL-04).
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
