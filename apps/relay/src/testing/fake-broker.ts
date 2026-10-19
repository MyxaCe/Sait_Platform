import { EventEmitter } from 'node:events';

/**
 * Двойник брокера AMQP для тестов релея.
 *
 * **Почему прежний двойник не ловил REL-04 и обязан был быть переписан.**
 * Он хранил обработчики в `Map`, то есть `on()` у него был учётом, а не
 * подпиской: «слушателя нет» и «слушатель есть» не различались ничем
 * наблюдаемым, и порядок навешивания не влиял на результат. Дефект же
 * состоит ровно в порядке. Двойник был неотличим от боевого драйвера по
 * сигнатурам и отличался по единственному свойству, которое проверяется.
 *
 * Здесь канал и соединение — настоящие `EventEmitter`: `emit('error')`
 * без слушателя бросает ошибку, как в Node.
 *
 * **Что моделирует `deliver`.** Ошибку уровня канала брокер присылает
 * КАДРОМ, который amqplib разбирает в обработчике соединения, — а не
 * возвратом вызова. Поэтому бросок из `emit` летит мимо `try/catch`
 * вызывающего и становится необработанным исключением процесса. Здесь
 * это ловится в `died`: с этого момента процесс считается мёртвым, и
 * двойник БД перестаёт принимать запросы — иначе тест проверял бы
 * вселенную, в которой упавший процесс ещё дописывает строки.
 */
export class FakeBroker {
  /** Какие обменники существуют. Пусто → `checkExchange` отказывает. */
  readonly exchanges = new Set<string>();
  /** Чем умер процесс, `null` — жив. */
  died: Error | null = null;
  /** Сколько раз брокер открывал соединение. */
  connects = 0;
  /** Опубликованные сообщения: routingKey + тело. */
  readonly published: { routingKey: string; body: string }[] = [];
  /** Все открытые соединения и каналы — в порядке открытия. */
  readonly connectionsOpened: FakeConnection[] = [];
  readonly channelsOpened: FakeChannel[] = [];

  constructor(exchanges: string[] = ['platform.events']) {
    for (const e of exchanges) this.exchanges.add(e);
  }

  /**
   * Доставить кадр от брокера так, как это делает Node: необработанное
   * исключение из обработчика события убивает процесс, а не возвращается
   * вызывающему.
   */
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

  /** Подменить `amqplib.connect` на этот брокер. */
  connectFn = (): Promise<FakeConnection> => Promise.resolve(this.connect());
}

export class FakeChannel extends EventEmitter {
  readonly calls = { checkExchange: 0, assertExchange: 0, publish: 0, close: 0 };
  /**
   * Какие слушатели висели на канале в момент ПЕРВОГО топологического
   * вызова. Снимается здесь, а не в тесте, потому что проверяется барьер
   * (слушатель поставлен вовремя), а не его следствие (сегодня отказ
   * никого не разбудил).
   */
  listenersAtFirstCall: string[] | null = null;

  constructor(
    private readonly broker: FakeBroker,
    private readonly connection: FakeConnection,
  ) {
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
    // Брокер закрывает канал ошибкой: кадр приходит отдельно от ответа на
    // вызов. Без слушателя `error` этот бросок уходит в процесс.
    this.broker.deliver(() => {
      this.emit('error', error);
      this.emit('close');
    });
    throw error;
  }

  async assertExchange(name: string): Promise<void> {
    this.noteFirstCall();
    this.calls.assertExchange += 1;
    // Активное объявление СОЗДАЁТ обменник — то самое тихое пересоздание,
    // ради отказа от которого сделан REL-03.
    this.broker.exchanges.add(name);
  }

  publish(exchange: string, routingKey: string, content: Buffer): boolean {
    this.calls.publish += 1;
    this.broker.published.push({ routingKey, body: content.toString() });
    return true;
  }

  async waitForConfirms(): Promise<void> {}

  async close(): Promise<void> {
    this.calls.close += 1;
    this.emit('close');
  }

  /** Брокер закрыл канал сам (например, при разрыве). */
  killByBroker(): void {
    this.broker.deliver(() => this.emit('close'));
  }

  get owner(): FakeConnection {
    return this.connection;
  }
}

export class FakeConnection extends EventEmitter {
  readonly channels: FakeChannel[] = [];

  constructor(private readonly broker: FakeBroker) {
    super();
  }

  async createConfirmChannel(): Promise<FakeChannel> {
    const channel = new FakeChannel(this.broker, this);
    this.channels.push(channel);
    this.broker.channelsOpened.push(channel);
    return channel;
  }

  async createChannel(): Promise<FakeChannel> {
    return this.createConfirmChannel();
  }

  async close(): Promise<void> {
    this.emit('close');
  }
}
