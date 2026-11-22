import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AmqpSubscriber, NullSubscriber, createSubscriber } from './subscriber.js';

function wiring(s: AmqpSubscriber): { exchange: string; queue: string; bindingKey: string } {
  const f = s as unknown as { exchange: string; queue: string; bindingKey: string };
  return { exchange: f.exchange, queue: f.queue, bindingKey: f.bindingKey };
}

const KEYS = ['BUS_URL', 'BUS_EXCHANGE', 'BUS_QUEUE', 'BUS_BINDING_KEY'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('WEB-24 · имена шины при пустом окружении', () => {
  it.each([
    ['пустые строки', ''],
    ['одни пробелы', '   '],
  ])('%s дают умолчания, а не пустые имена', (_name, blank) => {
    process.env.BUS_URL = 'amqp://localhost';
    process.env.BUS_EXCHANGE = blank;
    process.env.BUS_QUEUE = blank;
    process.env.BUS_BINDING_KEY = blank;

    const sub = createSubscriber();
    expect(sub).toBeInstanceOf(AmqpSubscriber);
    expect(wiring(sub as AmqpSubscriber)).toEqual({
      exchange: 'platform.events',
      queue: 'cabinet.terminal-projection',
      bindingKey: 'terminal.#',
    });
  });

  it('заданные значения проходят как есть — умолчание не перекрывает настройку', () => {
    process.env.BUS_URL = 'amqp://localhost';
    process.env.BUS_EXCHANGE = 'other.events';
    process.env.BUS_QUEUE = 'other.queue';
    process.env.BUS_BINDING_KEY = 'other.#';

    expect(wiring(createSubscriber() as AmqpSubscriber)).toEqual({
      exchange: 'other.events',
      queue: 'other.queue',
      bindingKey: 'other.#',
    });
  });

  it.each([
    ['пустой', ''],
    ['пробельный', '   '],
  ])('%s BUS_URL — это отсутствие шины, а не адрес', (_name, blank) => {
    process.env.BUS_URL = blank;
    expect(createSubscriber()).toBeInstanceOf(NullSubscriber);
  });
});
