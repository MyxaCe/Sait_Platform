import amqplib, { type ChannelModel, type Channel } from 'amqplib';

/**
 * Подписчик на шину платформы (зеркало publisher релея).
 * BUS_URL не задан (кредлы шины — созвон §10) → NullSubscriber: консюмер
 * собран и оттестирован, подключение реальной шины = установка env.
 * ACK только после успешной проекции; ошибка → nack без requeue в DLX
 * (повторную доставку решает дедуп по event_id, а не бесконечный requeue).
 */

export type MessageHandler = (raw: unknown) => Promise<void>;

export interface Subscriber {
  start(onMessage: MessageHandler): Promise<void>;
  close(): Promise<void>;
}

/** Заглушка без кредлов: не подключается, честно логирует ожидание. */
export class NullSubscriber implements Subscriber {
  async start(): Promise<void> {
    console.warn('[consumer] BUS_URL not set — idle (жду кредлов platform.events)');
  }
  async close(): Promise<void> {}
}

export class AmqpSubscriber implements Subscriber {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;

  constructor(
    private readonly url: string,
    private readonly exchange: string,
    private readonly queue: string,
    private readonly bindingKey: string,
  ) {}

  async start(onMessage: MessageHandler): Promise<void> {
    this.connection = await amqplib.connect(this.url);
    this.channel = await this.connection.createChannel();
    await this.channel.assertExchange(this.exchange, 'topic', { durable: true });
    // Durable-очередь с DLX: невалидные/сбойные сообщения уходят в разбор,
    // а не крутятся в requeue-цикле
    await this.channel.assertQueue(this.queue, {
      durable: true,
      deadLetterExchange: `${this.exchange}.dlx`,
    });
    await this.channel.bindQueue(this.queue, this.exchange, this.bindingKey);
    await this.channel.prefetch(16);

    await this.channel.consume(this.queue, (msg) => {
      if (!msg) return;
      let raw: unknown;
      try {
        raw = JSON.parse(msg.content.toString());
      } catch {
        this.channel?.nack(msg, false, false); // не-JSON → в DLX
        return;
      }
      onMessage(raw)
        .then(() => this.channel?.ack(msg))
        .catch((error) => {
          console.error('[consumer] handler error:', (error as Error).message);
          this.channel?.nack(msg, false, false); // сбой проекции → DLX (дедуп защитит от повтора)
        });
    });
    console.info(`[consumer] listening ${this.exchange} → ${this.queue} (${this.bindingKey})`);
  }

  async close(): Promise<void> {
    await this.channel?.close().catch(() => {});
    await this.connection?.close().catch(() => {});
  }
}

export function createSubscriber(): Subscriber {
  const url = process.env.BUS_URL;
  if (!url) return new NullSubscriber();
  const exchange = process.env.BUS_EXCHANGE ?? 'platform.events';
  const queue = process.env.BUS_QUEUE ?? 'cabinet.terminal-projection';
  const bindingKey = process.env.BUS_BINDING_KEY ?? 'terminal.#';
  return new AmqpSubscriber(url, exchange, queue, bindingKey);
}
