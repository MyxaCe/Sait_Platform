import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventEnvelope } from '@broker/api-client';
import { FakeBroker } from './testing/fake-broker.js';

/**
 * Издатель релея: REL-03 (пассивное объявление) и REL-04 (порядок
 * навешивания слушателей).
 *
 * **REL-03 — два следствия, и второе важнее первого:**
 *  1. `exchange.declare` требует `configure` всегда, даже когда обменник уже
 *     есть — с ним честный publish-only невозможен;
 *  2. пропавшая инфраструктура становится немедленным отказом вместо тихого
 *     пересоздания. `assertExchange` создал бы обменник заново, и исчезновение
 *     шины прошло бы незамеченным.
 *
 * **REL-04 — у отказа спрашивают не «виден ли он», а в каком из двух мест
 * он виден.** В логе процесса он был виден всегда; в состоянии строки
 * outbox — ни разу, потому что слушатель ошибок канала навешивался ПОСЛЕ
 * первого топологического вызова, и процесс умирал раньше, чем `catch`
 * запишет попытку. Здесь проверяется первая половина — «бросок не уходит в
 * процесс»; вторая половина — «строка получает `attempts` и текст ошибки» —
 * в `outbox.test.ts`. Уровни разные намеренно: покрытие единицы покрытием
 * пути не является.
 *
 * **Почему двойник переписан на `EventEmitter`.** Прежний хранил
 * обработчики в `Map`: `on()` у него был учётом, а не подпиской, и
 * «слушателя нет» ничем не отличалось от «слушатель есть». То есть
 * двойник был верен контракту по сигнатурам и слеп ровно к тому свойству,
 * которое здесь проверяется, — поэтому пять зелёных тестов жили рядом с
 * дефектом. Разбор — `testing/fake-broker.ts`.
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

beforeEach(() => {
  vi.resetModules();
  connect.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Брокер с обменником (по умолчанию) или без него (`[]`). */
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
    // Ровно то, из-за чего publish-only был невозможен
    expect(channel.calls.assertExchange).toBe(0);
    expect(b.published).toHaveLength(1);
  });

  it('обменника нет → немедленный отказ, а НЕ тихое пересоздание', async () => {
    const b = broker([]);

    const publisher = await newPublisher();
    await expect(publisher.publish('lead.submitted', ENVELOPE)).rejects.toThrow(/NOT_FOUND/);

    // Главное: обменник не создан и сообщение не отправлено «в никуда»
    expect(b.exchanges.has('platform.events')).toBe(false);
    expect(b.channelsOpened[0]!.calls.assertExchange).toBe(0);
    expect(b.published).toHaveLength(0);
  });

  it('после отказа канал не кешируется — следующая попытка переподключается', async () => {
    // Отказ, проявляющийся только при переподключении, тише отказа при старте:
    // мёртвый канал в поле давал бы вечный посторонний отказ
    const b = broker([]);

    const publisher = await newPublisher();
    await expect(publisher.publish('lead.submitted', ENVELOPE)).rejects.toThrow();

    b.exchanges.add('platform.events'); // владелец шины завёл обменник
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
    b.channelsOpened[0]!.killByBroker(); // брокер закрыл канал

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

    // В этом и была разница между «отказ виден в логе» и «отказ обработан»:
    // без слушателя бросок из `emit` уходил мимо промиса и убивал процесс
    // раньше, чем вызывающий записал попытку.
    expect(b.died).toBeNull();
  });

  it('слушатели канала навешаны ДО топологического вызова, а не после', async () => {
    // Проверяется БАРЬЕР (слушатель поставлен вовремя), а не его следствие
    // (сегодня отказ никого не разбудил). Иначе тест остался бы зелёным на
    // исправном брокере при вернувшемся дефекте.
    const b = broker();
    const publisher = await newPublisher();

    await publisher.publish('lead.submitted', ENVELOPE);

    expect(b.channelsOpened[0]!.listenersAtFirstCall).toEqual(
      expect.arrayContaining(['error', 'close']),
    );
  });

  it('у соединения тоже есть слушатель ошибок', async () => {
    // Соединение — тот же EventEmitter: ошибка его уровня без слушателя
    // убила бы процесс так же, как ошибка канала.
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
