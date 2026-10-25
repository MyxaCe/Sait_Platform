import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnStatus, Quote } from '../types';

/**
 * WEB-35 · драйвер РАЗБИРАЕТ тело, а не объявляет его.
 *
 * **Зачем отдельно от проверок разбора.** Те показывают, что функция
 * исправна. Они не показывают, что её зовут, — а подключение к типу
 * было ровно в драйвере, и снять разбор можно, не тронув ни одной
 * строки `parse-quote-batch.ts`. Класс «правило верное, но до него не
 * доносят» модульной проверкой не ловится в принципе; у меня он
 * проскакивал не раз.
 *
 * Поэтому здесь поддельный сокет: в него кладут то, что мог бы
 * прислать сосед, и спрашивают, что дошло до подписчика.
 */

const handlers = new Map<string, (payload: unknown) => void>();
const emitted: { event: string; payload: unknown }[] = [];

const fakeSocket = {
  on(event: string, cb: (payload: unknown) => void) {
    handlers.set(event, cb);
  },
  emit(event: string, payload: unknown) {
    emitted.push({ event, payload });
  },
  disconnect: vi.fn(),
  connected: true,
  io: { on: () => undefined },
};

vi.mock('socket.io-client', () => ({ io: () => fakeSocket }));

const { createSocketIoDriver } = await import('./socketio');

const good: Quote = {
  symbol: 'EURUSD',
  name: 'Euro / US Dollar',
  category: 'forex',
  price: 1.0842,
  digits: 5,
  changePercent: 0.12,
  ts: 1_700_000_000_000,
};

function connect(): { batches: Quote[][]; send: (payload: unknown) => void } {
  const batches: Quote[][] = [];
  const statuses: ConnStatus[] = [];
  const driver = createSocketIoDriver('http://feed.test');

  driver.connect(
    (b) => batches.push(b),
    (s) => statuses.push(s),
  );

  const onBatch = handlers.get('quotes:batch');
  if (!onBatch) throw new Error('драйвер не подписался на quotes:batch');

  return { batches, send: onBatch };
}

beforeEach(() => {
  handlers.clear();
  emitted.length = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

describe('WEB-35 · сокетный драйвер', () => {
  it('годное доходит до подписчика', () => {
    const { batches, send } = connect();

    send([good]);

    expect(batches).toEqual([[good]]);
  });

  it('негодное до подписчика НЕ доходит, годное из того же батча доходит', () => {
    const { batches, send } = connect();

    send([good, { ...good, symbol: 'BADPRICE', price: 'очень дорого' }]);

    expect(batches).toEqual([[good]]);
  });

  it('батч, из которого не понято ничего, обработчик не зовёт', () => {
    const { batches, send } = connect();

    // «Обновлений нет» и «мы ничего не поняли» — разные сообщения.
    send([{ price: 'x' }]);
    send('и вовсе не массив');

    expect(batches).toEqual([]);
  });

  it('незнакомое поле проходит насквозь и попадает в лог, а не в отказ', () => {
    const { batches, send } = connect();

    send([{ ...good, bid: 1.084 }]);

    expect(batches).toEqual([[good]]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('field:bid'));
  });

  it('об одном и том же сообщают один раз, а не четыре раза в секунду', () => {
    const { send } = connect();

    send([{ ...good, bid: 1 }]);
    send([{ ...good, bid: 2 }]);
    send([{ ...good, bid: 3 }]);

    // Шум отключают — и вместе с ним находку.
    expect(vi.mocked(console.warn).mock.calls).toHaveLength(1);
  });

  it('отказ назван: символ, поле и чем негоден', () => {
    const { send } = connect();

    send([{ ...good, symbol: 'BADTS', ts: 'вчера' }]);

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('BADTS'),
    );
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('ts'));
  });
});
