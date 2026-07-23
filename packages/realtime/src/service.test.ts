import { describe, expect, it, vi } from 'vitest';
import { RealtimeService } from './service';
import type { FeedDriver } from './types';

function createFakeDriver() {
  const calls = { subscribe: [] as string[][], unsubscribe: [] as string[][] };
  const driver: FeedDriver = {
    connect: vi.fn(),
    subscribe: (s) => calls.subscribe.push([...s]),
    unsubscribe: (s) => calls.unsubscribe.push([...s]),
    disconnect: vi.fn(),
  };
  return { driver, calls };
}

describe('RealtimeService: подписки по счётчику ссылок', () => {
  it('подписывается на символ один раз, сколько бы виджетов его ни смотрело', () => {
    const service = new RealtimeService();
    const { driver, calls } = createFakeDriver();
    service.connect(driver);

    const unsub1 = service.subscribe(['EURUSD', 'BTCUSD']);
    const unsub2 = service.subscribe(['EURUSD']); // второй виджет на тот же символ

    expect(calls.subscribe).toEqual([['EURUSD', 'BTCUSD']]); // EURUSD не дублируется

    unsub1();
    // EURUSD ещё держит второй подписчик — отписался только BTCUSD
    expect(calls.unsubscribe).toEqual([['BTCUSD']]);

    unsub2();
    expect(calls.unsubscribe).toEqual([['BTCUSD'], ['EURUSD']]);
  });

  it('восстанавливает подписки, оформленные до подключения', () => {
    const service = new RealtimeService();
    const { driver, calls } = createFakeDriver();

    service.subscribe(['XAUUSD']); // подписка до connect
    service.connect(driver);

    expect(calls.subscribe).toEqual([['XAUUSD']]);
  });

  it('повторный connect не создаёт второй драйвер', () => {
    const service = new RealtimeService();
    const { driver } = createFakeDriver();
    service.connect(driver);
    service.connect(driver);
    expect(driver.connect).toHaveBeenCalledTimes(1);
  });
});
