import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import * as Sentry from '@sentry/node';
import { Pool } from 'pg';
import { scrubSentryEvent } from '@broker/api-client';
import { applyTerminalEvent, classifyMessage } from './projection.js';
import { createSubscriber } from './subscriber.js';

// GlitchTip (site-bff /2): ошибки консюмера. Без DSN — выключен. Скраббинг до отправки.
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
 * Консюмер событий терминала (ADR-023 Т3): шина platform.events →
 * проекция в demo_accounts/позиции/сделки кабинета. Дедуп по event_id,
 * тенант-фильтр по SITE_SLUG. Без BUS_URL — простаивает (NullSubscriber),
 * подключение реальной шины = установка env (кредлы — созвон §10 с CRM).
 */

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('[consumer] DATABASE_URL is required');
  process.exit(1);
}

const tenant = process.env.SITE_SLUG ?? 'apex-ru';
const pool = new Pool({ connectionString: databaseUrl, max: 3 });
const subscriber = createSubscriber();

/**
 * Счётчики разбора (CON-03). Раньше «чужое» и «наше сломанное» были одинаково
 * невидимы: оба глотались одним `return`, и из трёх доставленных одно
 * подтверждалось и терялось. Считаем порознь — иначе по счётчику не отличить
 * здоровый пропуск соседского события от потери своего.
 */
export const parseStats = { foreign: 0, malformed: 0, applied: 0 };

/** Сломанное сообщение обязано попасть в DLQ — подписчик шлёт туда по throw. */
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
    // Норма, а не поломка: сосед выкатил тип, которого мы ещё не знаем.
    // Счётчик + отладочная строка, без шума в предупреждениях.
    parseStats.foreign += 1;
    console.debug(
      `[consumer] foreign event skipped: ${message.event} ${message.eventId} (foreign=${parseStats.foreign})`,
    );
    return;
  }

  if (message.kind === 'malformed') {
    // След в трёх местах: счётчик, предупреждение, DLQ (через throw).
    // Плюс трекер — тишина здесь и была причиной того, что потерю нашли
    // только на счётчиках брокера.
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
    throw error; // подписчик отправит в DLX; дедуп защитит при повторе
  } finally {
    client.release();
  }
}

// Keep-alive хэндл: с шиной loop держит открытый amqp-consumer, без шины
// (NullSubscriber) — этот таймер, иначе Node завершает процесс и restart-policy
// крутит сервис в цикле рестарта (pending-промис loop НЕ держит). Выход —
// только по сигналу (обработчики ниже).
const keepAlive = setInterval(() => {}, 1 << 30);

async function main() {
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
