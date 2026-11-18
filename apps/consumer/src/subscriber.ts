import amqplib, { type ChannelModel, type Channel } from 'amqplib';
import { envOr, readEnv } from '@broker/utils';

export type MessageHandler = (raw: unknown) => Promise<void>;

export interface Subscriber {
  start(onMessage: MessageHandler): Promise<void>;
  close(): Promise<void>;
}

export type FatalHandler = (where: 'connection' | 'channel', error: Error) => void;

const logFatal: FatalHandler = (where, error) => {
  console.error(`[consumer] ${where} error: ${error.message} — подписка мертва`);
};

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
    private readonly onFatal: FatalHandler = logFatal,
  ) {}

  async start(onMessage: MessageHandler): Promise<void> {
    const connection = await amqplib.connect(this.url);
    this.connection = connection;
    connection.on('error', (error: Error) => {
      this.connection = null;
      this.channel = null;
      this.onFatal('connection', error);
    });
    connection.on('close', () => {
      this.connection = null;
      this.channel = null;
    });

    const channel = await connection.createChannel();
    this.channel = channel;
    channel.on('error', (error: Error) => {
      this.channel = null;
      this.onFatal('channel', error);
    });
    channel.on('close', () => {
      this.channel = null;
    });

    await channel.checkExchange(this.exchange);
    await channel.assertQueue(this.queue, {
      durable: true,
      deadLetterExchange: `${this.exchange}.dlx`,
    });
    await channel.bindQueue(this.queue, this.exchange, this.bindingKey);
    await channel.prefetch(16);

    await channel.consume(this.queue, (msg) => {
      if (!msg) return;
      let raw: unknown;
      try {
        raw = JSON.parse(msg.content.toString());
      } catch {
        this.channel?.nack(msg, false, false);
        return;
      }
      onMessage(raw)
        .then(() => this.channel?.ack(msg))
        .catch((error) => {
          console.error('[consumer] handler error:', (error as Error).message);
          this.channel?.nack(msg, false, false);
        });
    });
    console.info(`[consumer] listening ${this.exchange} → ${this.queue} (${this.bindingKey})`);
  }

  async close(): Promise<void> {
    await this.channel?.close().catch(() => {});
    await this.connection?.close().catch(() => {});
  }
}

export function createSubscriber(onFatal?: FatalHandler): Subscriber {
  const url = readEnv(process.env.BUS_URL);
  if (!url) return new NullSubscriber();
  const exchange = envOr(process.env.BUS_EXCHANGE, 'platform.events');
  const queue = envOr(process.env.BUS_QUEUE, 'cabinet.terminal-projection');
  const bindingKey = envOr(process.env.BUS_BINDING_KEY, 'terminal.#');
  return new AmqpSubscriber(url, exchange, queue, bindingKey, onFatal);
}
