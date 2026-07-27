import { randomUUID } from 'node:crypto';
import amqplib from 'amqplib';

/**
 * Симулятор терминала: публикует ОДНО событие terminal.* в шину платформы
 * (конверт v1) — для проверки консюмера, пока настоящего продюсера терминала
 * нет. Использование:
 *   BUS_URL=amqp://... node scripts/publish-test-event.mjs <userId> [balanceCents]
 */

const [, , userId, balanceArg] = process.argv;
const url = process.env.BUS_URL;
const exchange = process.env.BUS_EXCHANGE ?? 'platform.events';
const tenant = process.env.SITE_SLUG ?? 'apex-ru';

if (!url || !userId) {
  console.error('usage: BUS_URL=amqp://... node scripts/publish-test-event.mjs <userId> [balanceCents]');
  process.exit(1);
}

const balanceCents = Number(balanceArg ?? 880000);
// EVENT_ID можно зафиксировать — для проверки дедупа (повторная доставка)
const eventId = process.env.EVENT_ID ?? randomUUID();
const envelope = {
  event_id: eventId,
  event: 'terminal.balance.changed',
  version: 1,
  occurred_at: new Date().toISOString(),
  source: 'terminal-test',
  subject: userId,
  data: {
    tenant,
    userId,
    balanceCents,
    reason: 'trade',
    positions: [{ symbol: 'BTCUSD', side: 'buy', volume: 0.05, entryPrice: 65000 }],
  },
};

const conn = await amqplib.connect(url);
const ch = await conn.createConfirmChannel();
await ch.assertExchange(exchange, 'topic', { durable: true });
ch.publish(exchange, envelope.event, Buffer.from(JSON.stringify(envelope)), {
  persistent: true,
  contentType: 'application/json',
  messageId: eventId,
});
await ch.waitForConfirms();
console.log(`published ${envelope.event} event_id=${eventId} userId=${userId} balanceCents=${balanceCents}`);
await ch.close();
await conn.close();
process.exit(0);
