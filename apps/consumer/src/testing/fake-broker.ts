import { EventEmitter } from 'node:events';

/**
 * Двойник брокера AMQP для тестов консюмера — зеркало такого же двойника
 * в релее (`apps/relay/src/testing/fake-broker.ts`).
 *
 * Канал и соединение — настоящие `EventEmitter`: `emit('error')` без
 * слушателя бросает ошибку, как в Node. Это и есть то свойство, ради
 * которого двойник существует: подписчик обязан навешивать слушателей ДО
 * первого топологического вызова, а двойник, у которого `on()` — просто
 * учёт, к порядку слеп и зеленеет на дефекте.
 *
 * `deliver` моделирует доставку кадра от брокера: исключение из
 * обработчика события не возвращается вызывающему, а убивает процесс.
 */
export class FakeBroker {
  readonly exchanges = new Set<string>();
  readonly queues = new Set<string>();
  /** Чем умер процесс, `null` — жив. */
  died: Error | null = null;
  connects = 0;
  readonly connectionsOpened: FakeConnection[] = [];
  readonly channelsOpened: FakeChannel[] = [];

  constructor(exchanges: string[] = ['platform.events']) {
    for (const e of exchanges) this.exchanges.add(e);
  }

  deliver(frame: () => void): void {
    if (this.died) return;
    try {
      frame();
    } catch (error) {
      this.died = error as Error;
    }
  }

  connect(): FakeConnection {
    this.connects += 1;
    const connection = new FakeConnection(this);
    this.connectionsOpened.push(connection);
    return connection;
  }

  connectFn = (): Promise<FakeConnection> => Promise.resolve(this.connect());
}

export class FakeChannel extends EventEmitter {
  readonly calls = { checkExchange: 0, assertExchange: 0, assertQueue: 0, consume: 0 };
  /** Слушатели на момент ПЕРВОГО топологического вызова — проверяем барьер. */
  listenersAtFirstCall: string[] | null = null;
  /** Обработчик, отданный `consume`: им в тесте подаются сообщения. */
  onDelivery: ((msg: unknown) => void) | null = null;

  constructor(private readonly broker: FakeBroker) {
    super();
  }

  private noteFirstCall(): void {
    this.listenersAtFirstCall ??= this.eventNames().map(String);
  }

  async checkExchange(name: string): Promise<void> {
    this.noteFirstCall();
    this.calls.checkExchange += 1;
    if (this.broker.exchanges.has(name)) return;
    const error = new Error(`NOT_FOUND - no exchange '${name}' in vhost '/'`);
    this.broker.deliver(() => {
      this.emit('error', error);
      this.emit('close');
    });
    throw error;
  }

  async assertExchange(name: string): Promise<void> {
    this.noteFirstCall();
    this.calls.assertExchange += 1;
    // Активное объявление СОЗДАЁТ обменник — то самое тихое пересоздание.
    this.broker.exchanges.add(name);
  }

  async assertQueue(name: string): Promise<{ queue: string }> {
    this.noteFirstCall();
    this.calls.assertQueue += 1;
    this.broker.queues.add(name);
    return { queue: name };
  }

  async bindQueue(): Promise<void> {}
  async prefetch(): Promise<void> {}

  async consume(_queue: string, handler: (msg: unknown) => void): Promise<{ consumerTag: string }> {
    this.calls.consume += 1;
    this.onDelivery = handler;
    return { consumerTag: 'fake' };
  }

  ack(): void {}
  nack(): void {}

  async close(): Promise<void> {
    this.emit('close');
  }

  /** Брокер убил канал на ходу (разрыв, снятие обменника, права). */
  killByBroker(error = new Error('CHANNEL_ERROR')): void {
    this.broker.deliver(() => {
      this.emit('error', error);
      this.emit('close');
    });
  }
}

export class FakeConnection extends EventEmitter {
  constructor(private readonly broker: FakeBroker) {
    super();
  }

  async createChannel(): Promise<FakeChannel> {
    const channel = new FakeChannel(this.broker);
    this.broker.channelsOpened.push(channel);
    return channel;
  }

  async close(): Promise<void> {
    this.emit('close');
  }
}
