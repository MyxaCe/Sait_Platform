import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealtimeService } from './service';
import { useQuotesStore } from './store';
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
    const unsub2 = service.subscribe(['EURUSD']);

    expect(calls.subscribe).toEqual([['EURUSD', 'BTCUSD']]);

    unsub1();
    expect(calls.unsubscribe).toEqual([['BTCUSD']]);

    unsub2();
    expect(calls.unsubscribe).toEqual([['BTCUSD'], ['EURUSD']]);
  });

  it('восстанавливает подписки, оформленные до подключения', () => {
    const service = new RealtimeService();
    const { driver, calls } = createFakeDriver();

    service.subscribe(['XAUUSD']);
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

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('RealtimeService: подлинность данных', () => {
  function driverClaiming(status: 'connected' | 'reconnecting') {
    let emit: ((s: 'connected' | 'reconnecting') => void) | null = null;
    const driver: FeedDriver = {
      connect: (_onBatch, onStatus) => {
        emit = onStatus as typeof emit;
      },
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      disconnect: vi.fn(),
    };
    return { driver, claim: () => emit?.(status) };
  }

  it('без адреса источника рапорт connected подменяется на simulated', () => {
    vi.stubEnv('NEXT_PUBLIC_WS_URL', '');
    const { driver, claim } = driverClaiming('connected');

    new RealtimeService().connect(driver);
    claim();

    expect(useQuotesStore.getState().status).toBe('simulated');
  });

  it('без адреса источника даже reconnecting становится simulated', () => {
    vi.stubEnv('NEXT_PUBLIC_WS_URL', '');
    const { driver, claim } = driverClaiming('reconnecting');

    new RealtimeService().connect(driver);
    claim();

    expect(useQuotesStore.getState().status).toBe('simulated');
  });

  it('с адресом источника статус драйвера проходит как есть', () => {
    vi.stubEnv('NEXT_PUBLIC_WS_URL', 'wss://feed.example.test');
    const { driver, claim } = driverClaiming('connected');

    new RealtimeService().connect(driver);
    claim();

    expect(useQuotesStore.getState().status).toBe('connected');
  });
});
