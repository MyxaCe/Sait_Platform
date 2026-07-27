import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { applyTerminalEvent, parseMessage } from './projection.js';
import { createSubscriber } from './subscriber.js';

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

async function handle(raw: unknown): Promise<void> {
  const event = parseMessage(raw);
  if (!event) return; // не-терминальное/невалидное — молча пропускаем
  const eventId = (raw as { event_id: string }).event_id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const outcome = await applyTerminalEvent(client, eventId, event, { tenant, newId: randomUUID });
    await client.query('COMMIT');
    if (outcome === 'applied') console.info(`[consumer] ${event.name} ${eventId} applied`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
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
