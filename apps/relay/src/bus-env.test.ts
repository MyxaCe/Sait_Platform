import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AmqpPublisher, LogPublisher, createPublisher } from './publisher.js';

function exchangeOf(p: AmqpPublisher): string {
  return (p as unknown as { exchange: string }).exchange;
}

const KEYS = ['BUS_URL', 'BUS_EXCHANGE'] as const;
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

describe('WEB-24 · имя обменника при пустом окружении', () => {
  it.each([
    ['пустая строка', ''],
    ['одни пробелы', '  '],
  ])('%s даёт platform.events', (_name, blank) => {
    process.env.BUS_URL = 'amqp://localhost';
    process.env.BUS_EXCHANGE = blank;

    const pub = createPublisher();
    expect(pub).toBeInstanceOf(AmqpPublisher);
    expect(exchangeOf(pub as AmqpPublisher)).toBe('platform.events');
  });

  it('заданный обменник проходит как есть', () => {
    process.env.BUS_URL = 'amqp://localhost';
    process.env.BUS_EXCHANGE = 'other.events';
    expect(exchangeOf(createPublisher() as AmqpPublisher)).toBe('other.events');
  });

  it('пустой BUS_URL — отсутствие шины: публикация в лог', () => {
    process.env.BUS_URL = '  ';
    expect(createPublisher()).toBeInstanceOf(LogPublisher);
  });
});
