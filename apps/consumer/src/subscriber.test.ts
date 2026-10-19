import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeBroker } from './testing/fake-broker.js';

/**
 * Подписчик консюмера: CON-04 (пассивное объявление обменника) и
 * зеркало REL-04 (слушатели ошибок до первого топологического вызова).
 *
 * **CON-04 — главное тут не права.** Пассивное объявление превращает
 * пропавшую инфраструктуру в немедленный отказ вместо тихого
 * пересоздания: `assertExchange` завёл бы обменник заново, консюмер
 * подписался бы на пустое место и молчал бы как исправный — отказ,
 * выглядящий как отсутствие событий. Побочное следствие (и то, что
 * блокирует команду `deploy`): `exchange.declare` требует `configure`
 * ВСЕГДА, поэтому с `assertExchange` сузить права кредлу `cabinet`
 * нельзя.
 *
 * **Очередь остаётся активной сознательно** — её владелец консюмер, и
 * `configure` на `cabinet.terminal-projection` у кредла есть по решению
 * штаба (КОНТРАКТЫ.md §2). Потерянную очередь некому пересоздать, в
 * отличие от обменника.
 *
 * **REL-04 — порядок.** Ошибка уровня канала приходит событием из
 * обработчика кадров соединения: без слушателя бросок уходит мимо
 * промиса и убивает процесс. В релее это стоило нулевых `attempts` в
 * outbox; здесь — отказа подписки без следа где-либо, кроме лога.
 */

const connect = vi.fn();
vi.mock('amqplib', () => ({ default: { connect: (...a: unknown[]) => connect(...a) } }));

beforeEach(() => {
  vi.resetModules();
  connect.mockReset();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
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

async function newSubscriber(onFatal?: (where: 'connection' | 'channel', e: Error) => void) {
  const { AmqpSubscriber } = await import('./subscriber.js');
  return new AmqpSubscriber(
    'amqp://test',
    'platform.events',
    'cabinet.terminal-projection',
    'terminal.#',
    onFatal,
  );
}

describe('AmqpSubscriber · пассивное объявление обменника (CON-04)', () => {
  it('объявляет пассивно: checkExchange вызван, assertExchange — нет', async () => {
    const b = broker();

    await (await newSubscriber()).start(async () => {});

    const channel = b.channelsOpened[0]!;
    expect(channel.calls.checkExchange).toBe(1);
    // Ровно то, из-за чего нельзя сузить права кредлу `cabinet`
    expect(channel.calls.assertExchange).toBe(0);
  });

  it('обменника нет → старт отказывает, обменник НЕ создан', async () => {
    const b = broker([]);

    await expect((await newSubscriber()).start(async () => {})).rejects.toThrow(/NOT_FOUND/);

    // Тихое пересоздание и есть то, от чего уходим: подписка на пустое
    // место молчала бы как исправная
    expect(b.exchanges.has('platform.events')).toBe(false);
    expect(b.channelsOpened[0]!.calls.assertExchange).toBe(0);
    expect(b.channelsOpened[0]!.calls.consume).toBe(0);
  });

  it('очередь по-прежнему объявляется активно — её владелец консюмер', async () => {
    // Растяжка: сделать пассивной заодно и очередь было бы «единообразно»
    // и неверно — потерянную очередь некому пересоздать.
    const b = broker();

    await (await newSubscriber()).start(async () => {});

    expect(b.channelsOpened[0]!.calls.assertQueue).toBe(1);
    expect(b.queues.has('cabinet.terminal-projection')).toBe(true);
  });
});

describe('AmqpSubscriber · слушатель ошибок до первого вызова (REL-04)', () => {
  it('ошибка канала на checkExchange НЕ уходит в процесс', async () => {
    const b = broker([]);

    await expect((await newSubscriber()).start(async () => {})).rejects.toThrow(/NOT_FOUND/);

    expect(b.died).toBeNull();
  });

  it('слушатели канала навешаны ДО топологического вызова, а не после', async () => {
    // Барьер, а не следствие: на исправном брокере отказ никого не будит,
    // и проверка «процесс жив» осталась бы зелёной при вернувшемся дефекте.
    const b = broker();

    await (await newSubscriber()).start(async () => {});

    expect(b.channelsOpened[0]!.listenersAtFirstCall).toEqual(
      expect.arrayContaining(['error', 'close']),
    );
  });

  it('отказ канала ПОСЛЕ старта не молчит: обработчик вызван', async () => {
    // Молчание здесь — «контейнер Up, связи нет»: здоровье процесса не
    // означает наличия связи.
    const b = broker();
    const fatal = vi.fn();

    await (await newSubscriber(fatal)).start(async () => {});
    b.channelsOpened[0]!.killByBroker(new Error('ACCESS_REFUSED'));

    expect(b.died).toBeNull();
    expect(fatal).toHaveBeenCalledWith('channel', expect.objectContaining({ message: 'ACCESS_REFUSED' }));
  });

  it('отказ соединения после старта тоже не молчит', async () => {
    const b = broker();
    const fatal = vi.fn();

    await (await newSubscriber(fatal)).start(async () => {});
    b.deliver(() => b.connectionsOpened[0]!.emit('error', new Error('CONNECTION_FORCED')));

    expect(b.died).toBeNull();
    expect(fatal).toHaveBeenCalledWith('connection', expect.any(Error));
  });
});

describe('createSubscriber · без BUS_URL', () => {
  it('уходит в NullSubscriber и не трогает шину', async () => {
    vi.stubEnv('BUS_URL', '');
    const { createSubscriber, NullSubscriber } = await import('./subscriber.js');
    expect(createSubscriber()).toBeInstanceOf(NullSubscriber);
    expect(connect).not.toHaveBeenCalled();
  });
});
