import { EventEmitter } from 'node:events';

export class FakeBroker {
  readonly exchanges = new Set<string>();
  died: Error | null = null;
  connects = 0;
  readonly published: { routingKey: string; body: string }[] = [];
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
  readonly calls = { checkExchange: 0, assertExchange: 0, publish: 0, close: 0 };
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
    this.broker.deliver(() => {
      this.emit('error', error);
      this.emit('close');
    });
    throw error;
  }

  async assertExchange(name: string): Promise<void> {
    this.noteFirstCall();
    this.calls.assertExchange += 1;
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
