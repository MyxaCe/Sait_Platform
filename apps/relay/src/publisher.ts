import amqplib, { type ChannelModel, type ConfirmChannel } from 'amqplib';
import type { EventEnvelope } from '@broker/api-client';
import { envOr, readEnv } from '@broker/utils';

/**
 * Издатель событий в шину платформы.
 * BUS_URL не задан (кредлы выдаются на созвоне §10) → LogPublisher:
 * контур outbox→релей работает и проверяется уже сейчас, подключение
 * реальной шины = установка env-переменной.
 */
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
    // Слушатель ошибок СОЕДИНЕНИЯ — по той же причине, что и у канала
    // (REL-04), и тоже до первого вызова, который может отказать:
    // `EventEmitter` без слушателя `error` бросает ошибку мимо промиса,
    // прямо в процесс.
    connection.on('error', () => {
      this.connection = null;
      this.channel = null;
    });

    try {
      const channel = await connection.createConfirmChannel();

      // REL-04: слушатели ошибок канала вешаются ДО первого
      // топологического вызова, а не после. Порядок здесь — поведение,
      // а не стиль.
      //
      // Ошибка уровня канала приходит СОБЫТИЕМ из обработчика кадров
      // соединения, а не возвратом вызова: `checkExchange` на пропавшем
      // обменнике и отклоняет свой промис, и эмитит `error` на канале.
      // Без слушателя `EventEmitter` бросает её мимо всех `try/catch` —
      // процесс умирает раньше, чем вызывающий запишет попытку, и строка
      // outbox остаётся с `attempts = 0` и пустым `last_error`: повторы
      // не отрабатывают ни разу. Отказ, видимый в логе процесса и
      // невидимый в состоянии строки, выглядит обработанным и не
      // обработан.
      //
      // Второе назначение тех же слушателей прежнее: канал умирает
      // отдельно от соединения, и без сброса кеша следующая публикация
      // ушла бы в мёртвый канал и падала бы вечно с посторонней ошибкой.
      channel.on('close', () => {
        this.channel = null;
      });
      channel.on('error', () => {
        this.channel = null;
      });

      // ПАССИВНОЕ объявление (REL-03). Два следствия, и второе важнее:
      //  1. `exchange.declare` требует `configure` ВСЕГДА, даже когда обменник
      //     уже есть — с ним честный publish-only невозможен;
      //  2. пропавшая инфраструктура становится немедленным отказом вместо
      //     тихого пересоздания. `assertExchange` молча создал бы обменник
      //     заново, и мы бы не узнали, что шину переставили под нами.
      // Обменник создаёт владелец шины один раз, релей его только требует.
      await channel.checkExchange(this.exchange);

      this.connection = connection;
      this.channel = channel;
      return channel;
    } catch (error) {
      // checkExchange на отсутствующем обменнике закрывает канал. Гарантия, что
      // мёртвый канал не осядет в поле, — это ПОРЯДОК выше: `this.channel`
      // присваивается только после успешной проверки. Обнулять здесь нечего, и
      // строчка `this.channel = null` была бы недоказуемой: её удаление не
      // роняет ни один тест, потому что она ничего не меняет.
      //
      // Мутация, которую покрасить нечем (названа вслух, чтобы следующий не
      // «дозакрывал» её бесполезной проверкой): снятие `.catch(() => {})` у
      // `connection.close()`. Отказ закрытия уже разорванного соединения
      // ничего не добавляет к ошибке, которая сейчас полетит наружу.
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
  // `readEnv`, а не голое чтение: `BUS_URL='   '` — строка истинная, и
  // проверка `!url` её пропускала. Релей строил AMQP-издателя с
  // пробельным адресом, фолбэк «публикуем в лог» не срабатывал, и
  // вместо названного отказа выходила невнятная ошибка подключения.
  const url = readEnv(process.env.BUS_URL);
  if (!url) {
    console.warn('[relay] BUS_URL not set — publishing to log only');
    return new LogPublisher();
  }
  // Пустое имя обменника — НЕ «пусто»: в AMQP это обменник по
  // умолчанию, и он работает. Сообщение уйдёт не в `platform.events`,
  // а в очередь, чьё имя совпало с ключом маршрутизации, — то есть
  // никуда, но без единой ошибки. `??` пустую строку пропускает,
  // `envOr` считает её отсутствием (WEB-24, Р-225).
  const exchange = envOr(process.env.BUS_EXCHANGE, 'platform.events');
  return new AmqpPublisher(url, exchange);
}
