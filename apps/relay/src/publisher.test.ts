import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventEnvelope } from '@broker/api-client';
import { FakeBroker } from './testing/fake-broker.js';

const connect = vi.fn();
vi.mock('amqplib', () => ({ default: { connect: (...a: unknown[]) => connect(...a) } }));

const ENVELOPE = {
  event_id: '11111111-2222-3333-4444-555555555555',
  event: 'lead.submitted',
  version: 1,
  occurred_at: '2026-09-03T10:00:00.000Z',
  source: 'site-web',
  data: {},
} as unknown as EventEnvelope;

beforeEach(() => {
  vi.resetModules();
  connect.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function broker(exchanges: string[] = ['platform.events']) {
  const b = new FakeBroker(exchanges);
  connect.mockImplementation(b.connectFn);
  return b;
}

async function newPublisher(exchange = 'platform.events') {
  const { AmqpPublisher } = await import('./publisher.js');
  return new AmqpPublisher('amqp://test', exchange);
}

describe('AmqpPublisher · пассивное объявление обменника (REL-03)', () => {
  it('объявляет пассивно: checkExchange вызван, assertExchange — нет', async () => {
    const b = broker();

    await (await newPublisher()).publish('lead.submitted', ENVELOPE);

    const channel = b.channelsOpened[0]!;
    expect(channel.calls.checkExchange).toBe(1);
    expect(channel.calls.assertExchange).toBe(0);
    expect(b.published).toHaveLength(1);
  });

  it('обменника нет → немедленный отказ, а НЕ тихое пересоздание', async () => {
    const b = broker([]);

    const publisher = await newPublisher();
    await expect(publisher.publish('lead.submitted', ENVELOPE)).rejects.toThrow(/NOT_FOUND/);

    expect(b.exchanges.has('platform.events')).toBe(false);
    expect(b.channelsOpened[0]!.calls.assertExchange).toBe(0);
    expect(b.published).toHaveLength(0);
  });

  it('после отказа канал не кешируется — следующая попытка переподключается', async () => {
    const b = broker([]);

    const publisher = await newPublisher();
    await expect(publisher.publish('lead.submitted', ENVELOPE)).rejects.toThrow();

    b.exchanges.add('platform.events');
    await publisher.publish('lead.submitted', ENVELOPE);

    expect(b.connects).toBe(2);
    expect(b.published).toHaveLength(1);
  });

  it('исправный канал переиспользуется: одно соединение на серию публикаций', async () => {
    const b = broker();

    const publisher = await newPublisher();
    await publisher.publish('lead.submitted', ENVELOPE);
    await publisher.publish('lead.submitted', ENVELOPE);

    expect(b.connects).toBe(1);
    expect(b.channelsOpened[0]!.calls.checkExchange).toBe(1);
    expect(b.published).toHaveLength(2);
  });

  it('закрытие канала брокером сбрасывает кеш — следующая публикация переподключается', async () => {
    const b = broker();

    const publisher = await newPublisher();
    await publisher.publish('lead.submitted', ENVELOPE);
    b.channelsOpened[0]!.killByBroker();

    await publisher.publish('lead.submitted', ENVELOPE);

    expect(b.connects).toBe(2);
    expect(b.channelsOpened[1]!.calls.checkExchange).toBe(1);
    expect(b.published).toHaveLength(2);
  });
});

describe('AmqpPublisher · слушатель ошибок до первого вызова (REL-04)', () => {
  it('ошибка канала на checkExchange НЕ уходит в процесс', async () => {
    const b = broker([]);

    const publisher = await newPublisher();
    await expect(publisher.publish('lead.submitted', ENVELOPE)).rejects.toThrow(/NOT_FOUND/);

    expect(b.died).toBeNull();
  });

  it('слушатели канала навешаны ДО топологического вызова, а не после', async () => {
    const b = broker();
    const publisher = await newPublisher();

    await publisher.publish('lead.submitted', ENVELOPE);

    expect(b.channelsOpened[0]!.listenersAtFirstCall).toEqual(
      expect.arrayContaining(['error', 'close']),
    );
  });

  it('у соединения тоже есть слушатель ошибок', async () => {
    const b = broker();
    const publisher = await newPublisher();
    await publisher.publish('lead.submitted', ENVELOPE);

    b.deliver(() => b.connectionsOpened[0]!.emit('error', new Error('CONNECTION_FORCED')));

    expect(b.died).toBeNull();
  });
});

describe('createPublisher · без BUS_URL', () => {
  it('уходит в LogPublisher и не трогает шину', async () => {
    vi.stubEnv('BUS_URL', '');
    const { createPublisher, LogPublisher } = await import('./publisher.js');
    expect(createPublisher()).toBeInstanceOf(LogPublisher);
    expect(connect).not.toHaveBeenCalled();
  });
});
