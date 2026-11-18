import amqplib, { type ChannelModel, type ConfirmChannel } from 'amqplib';
import type { EventEnvelope } from '@broker/api-client';
import { envOr, readEnv } from '@broker/utils';

export interface Publisher {
  publish(routingKey: string, envelope: EventEnvelope): Promise<void>;
  close(): Promise<void>;
}

export class LogPublisher implements Publisher {
  async publish(routingKey: string, envelope: EventEnvelope): Promise<void> {
    console.info(`[relay:log] ${routingKey} ${envelope.event_id}`, JSON.stringify(envelope));
  }
  async close(): Promise<void> {}
}

export class AmqpPublisher implements Publisher {
  private connection: ChannelModel | null = null;
  private channel: ConfirmChannel | null = null;

  constructor(
    private readonly url: string,
    private readonly exchange: string,
  ) {}

  private async ensureChannel(): Promise<ConfirmChannel> {
    if (this.channel) return this.channel;
    const connection = await amqplib.connect(this.url);
    connection.on('close', () => {
      this.connection = null;
      this.channel = null;
    });
    connection.on('error', () => {
      this.connection = null;
      this.channel = null;
    });

    try {
      const channel = await connection.createConfirmChannel();

      channel.on('close', () => {
        this.channel = null;
      });
      channel.on('error', () => {
        this.channel = null;
      });

      await channel.checkExchange(this.exchange);

      this.connection = connection;
      this.channel = channel;
      return channel;
    } catch (error) {
      await connection.close().catch(() => {});
      throw error;
    }
  }

  async publish(routingKey: string, envelope: EventEnvelope): Promise<void> {
    const channel = await this.ensureChannel();
    channel.publish(this.exchange, routingKey, Buffer.from(JSON.stringify(envelope)), {
      persistent: true,
      contentType: 'application/json',
      messageId: envelope.event_id,
      timestamp: Math.floor(Date.parse(envelope.occurred_at) / 1000),
    });
    await channel.waitForConfirms();
  }

  async close(): Promise<void> {
    await this.channel?.close().catch(() => {});
    await this.connection?.close().catch(() => {});
  }
}

export function createPublisher(): Publisher {
  const url = readEnv(process.env.BUS_URL);
  if (!url) {
    console.warn('[relay] BUS_URL not set — publishing to log only');
    return new LogPublisher();
  }
  const exchange = envOr(process.env.BUS_EXCHANGE, 'platform.events');
  return new AmqpPublisher(url, exchange);
}
