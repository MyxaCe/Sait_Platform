import amqplib, { type ChannelModel, type Channel } from 'amqplib';

/**
 * Подписчик на шину платформы (зеркало publisher релея).
 * BUS_URL не задан (кредлы шины — созвон §10) → NullSubscriber: консюмер
 * собран и оттестирован, подключение реальной шины = установка env.
 * ACK только после успешной проекции; ошибка → nack без requeue в DLX
 * (повторную доставку решает дедуп по event_id, а не бесконечный requeue).
 *
 * **CON-04: обменник объявляется ПАССИВНО** (`checkExchange`), зеркало
 * REL-03 в релее. Главное здесь не права: пассивное объявление
 * превращает пропавшую инфраструктуру в немедленный отказ вместо тихого
 * пересоздания — `assertExchange` завёл бы обменник заново, консюмер
 * подписался бы на пустое место и молчал бы как исправный. Побочное
 * следствие — `exchange.declare` требует `configure` ВСЕГДА, и без него
 * команда `deploy` не может сузить права кредлу `cabinet`.
 *
 * Очередь остаётся активной: её владелец — консюмер, и `configure` на
 * `cabinet.terminal-projection` у кредла есть по решению штаба
 * (КОНТРАКТЫ.md §2). Пассивной её делать нечему — потерянную очередь
 * некому пересоздать.
 *
 * **REL-04: слушатели ошибок — ДО первого топологического вызова.**
 * Ошибка уровня канала приходит событием из обработчика кадров
 * соединения, а не возвратом вызова: без слушателя `EventEmitter`
 * бросает её мимо всех `try/catch`, и процесс умирает раньше, чем
 * вызывающий успеет что-нибудь записать. У релея это стоило нулевых
 * `attempts` в outbox; здесь — отказ подписки, не оставляющий следа
 * нигде, кроме лога процесса.
 */

export type MessageHandler = (raw: unknown) => Promise<void>;

export interface Subscriber {
  start(onMessage: MessageHandler): Promise<void>;
  close(): Promise<void>;
}

/**
 * Что делать с отказом шины ПОСЛЕ успешного старта.
 *
 * Пустой слушатель здесь был бы правилом, которое выглядит рабочим и
 * ничего не делает: канал умер, процесс жив, контейнер `Up`, сообщения
 * не читаются — здоровье процесса не означает наличия связи. Поэтому
 * обработчик обязателен и приходит снаружи: решение «логировать и выйти,
 * чтобы перезапуск переподключил» принимает `index.ts`, а не транспорт.
 */
export type FatalHandler = (where: 'connection' | 'channel', error: Error) => void;

const logFatal: FatalHandler = (where, error) => {
  console.error(`[consumer] ${where} error: ${error.message} — подписка мертва`);
};

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
    private readonly onFatal: FatalHandler = logFatal,
  ) {}

  async start(onMessage: MessageHandler): Promise<void> {
    const connection = await amqplib.connect(this.url);
    this.connection = connection;
    // Слушатели — ДО первого топологического вызова (REL-04). После него
    // было бы поздно: отказ `checkExchange` эмитит `error` на канале, и
    // без слушателя этот бросок убивает процесс мимо `try/catch`.
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

    // ПАССИВНОЕ объявление обменника (CON-04): пропавшая инфраструктура —
    // немедленный отказ, а не тихое пересоздание. Обменник заводит
    // владелец шины один раз, консюмер его только требует.
    await channel.checkExchange(this.exchange);
    // Durable-очередь с DLX: невалидные/сбойные сообщения уходят в разбор,
    // а не крутятся в requeue-цикле
    // Дальше по локальной ссылке, а не по полю: слушатель `close`
    // обнуляет поле, и на мёртвом канале `this.channel.assertQueue`
    // упало бы `TypeError`-ом вместо настоящей ошибки шины — отказ,
    // переодетый в чужую ошибку.
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

export function createSubscriber(onFatal?: FatalHandler): Subscriber {
  const url = process.env.BUS_URL;
  if (!url) return new NullSubscriber();
  const exchange = process.env.BUS_EXCHANGE ?? 'platform.events';
  const queue = process.env.BUS_QUEUE ?? 'cabinet.terminal-projection';
  const bindingKey = process.env.BUS_BINDING_KEY ?? 'terminal.#';
  return new AmqpSubscriber(url, exchange, queue, bindingKey, onFatal);
}
