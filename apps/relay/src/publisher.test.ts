import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventEnvelope } from '@broker/api-client';

/**
 * REL-03: релей объявляет обменник ПАССИВНО.
 *
 * Два следствия, и второе важнее первого:
 *  1. `exchange.declare` требует `configure` всегда, даже когда обменник уже
 *     есть — с ним честный publish-only невозможен;
 *  2. пропавшая инфраструктура становится немедленным отказом вместо тихого
 *     пересоздания. `assertExchange` создал бы обменник заново, и исчезновение
 *     шины прошло бы незамеченным.
 */

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

/** Канал-двойник: считает вызовы и умеет падать на checkExchange. */
function fakeChannel(opts: { missingExchange?: boolean } = {}) {
  const calls = { checkExchange: 0, assertExchange: 0, publish: 0, close: 0 };
  const handlers = new Map<string, () => void>();
  const channel = {
    checkExchange: vi.fn(async () => {
      calls.checkExchange += 1;
      if (opts.missingExchange) {
        // Ошибка уровня канала закрывает канал — так ведёт себя брокер
        handlers.get('close')?.();
        throw new Error("NOT_FOUND - no exchange 'platform.events'");
      }
    }),
    assertExchange: vi.fn(async () => {
      calls.assertExchange += 1;
    }),
    publish: vi.fn(() => {
      calls.publish += 1;
      return true;
    }),
    waitForConfirms: vi.fn(async () => {}),
    close: vi.fn(async () => {
      calls.close += 1;
    }),
    on: vi.fn((event: string, cb: () => void) => {
      handlers.set(event, cb);
    }),
  };
  return { channel, calls, handlers };
}

function fakeConnection(channel: unknown) {
  return {
    createConfirmChannel: vi.fn(async () => channel),
    on: vi.fn(),
    close: vi.fn(async () => {}),
  };
}

beforeEach(() => {
  vi.resetModules();
  connect.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function newPublisher(exchange = 'platform.events') {
  const { AmqpPublisher } = await import('./publisher.js');
  return new AmqpPublisher('amqp://test', exchange);
}

describe('AmqpPublisher · пассивное объявление обменника', () => {
  it('объявляет пассивно: checkExchange вызван, assertExchange — нет', async () => {
    const { channel, calls } = fakeChannel();
    connect.mockResolvedValue(fakeConnection(channel));

    await (await newPublisher()).publish('lead.submitted', ENVELOPE);

    expect(calls.checkExchange).toBe(1);
    // Ровно то, из-за чего publish-only был невозможен
    expect(calls.assertExchange).toBe(0);
    expect(calls.publish).toBe(1);
  });

  it('обменника нет → немедленный отказ, а НЕ тихое пересоздание', async () => {
    const { channel, calls } = fakeChannel({ missingExchange: true });
    connect.mockResolvedValue(fakeConnection(channel));

    const publisher = await newPublisher();
    await expect(publisher.publish('lead.submitted', ENVELOPE)).rejects.toThrow(/NOT_FOUND/);

    // Главное: обменник не создан и сообщение не отправлено «в никуда»
    expect(calls.assertExchange).toBe(0);
    expect(calls.publish).toBe(0);
  });

  it('после отказа канал не кешируется — следующая попытка переподключается', async () => {
    // Отказ, проявляющийся только при переподключении, тише отказа при старте:
    // мёртвый канал в поле давал бы вечный посторонний отказ
    const broken = fakeChannel({ missingExchange: true });
    const healthy = fakeChannel();
    connect
      .mockResolvedValueOnce(fakeConnection(broken.channel))
      .mockResolvedValueOnce(fakeConnection(healthy.channel));

    const publisher = await newPublisher();
    await expect(publisher.publish('lead.submitted', ENVELOPE)).rejects.toThrow();
    await publisher.publish('lead.submitted', ENVELOPE);

    expect(connect).toHaveBeenCalledTimes(2);
    expect(healthy.calls.publish).toBe(1);
  });

  it('исправный канал переиспользуется: одно соединение на серию публикаций', async () => {
    const { channel, calls } = fakeChannel();
    connect.mockResolvedValue(fakeConnection(channel));

    const publisher = await newPublisher();
    await publisher.publish('lead.submitted', ENVELOPE);
    await publisher.publish('lead.submitted', ENVELOPE);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(calls.checkExchange).toBe(1);
    expect(calls.publish).toBe(2);
  });

  it('закрытие канала брокером сбрасывает кеш — следующая публикация переподключается', async () => {
    const first = fakeChannel();
    const second = fakeChannel();
    connect
      .mockResolvedValueOnce(fakeConnection(first.channel))
      .mockResolvedValueOnce(fakeConnection(second.channel));

    const publisher = await newPublisher();
    await publisher.publish('lead.submitted', ENVELOPE);
    first.handlers.get('close')?.(); // брокер закрыл канал

    await publisher.publish('lead.submitted', ENVELOPE);

    expect(connect).toHaveBeenCalledTimes(2);
    expect(second.calls.checkExchange).toBe(1);
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
