import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDriver } from './mock';
import type { ConnStatus, Quote } from '../types';

beforeEach(() => {
  vi.useFakeTimers();
  // Убираем случайность: 0.5 → тик обновляет каждый подписанный символ
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('mock driver', () => {
  it('подключается и шлёт мгновенный снапшот подписанных символов', () => {
    const driver = createMockDriver();
    const batches: Quote[][] = [];
    const statuses: ConnStatus[] = [];

    driver.subscribe(['EURUSD', 'XAUUSD']);
    driver.connect(
      (b) => batches.push(b),
      (s) => statuses.push(s),
    );

    expect(statuses).toEqual(['connecting']);

    vi.advanceTimersByTime(500); // CONNECT_DELAY_MS = 400
    expect(statuses).toEqual(['connecting', 'connected']);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.map((q) => q.symbol).sort()).toEqual(['EURUSD', 'XAUUSD']);
  });

  it('тикает по интервалу и меняет цены в пределах волатильности', () => {
    const driver = createMockDriver();
    const batches: Quote[][] = [];

    driver.subscribe(['EURUSD']);
    driver.connect(
      (b) => batches.push(b),
      () => {},
    );

    vi.advanceTimersByTime(500); // снапшот
    const initial = batches[0]![0]!.price;

    vi.advanceTimersByTime(800); // один тик
    expect(batches.length).toBeGreaterThanOrEqual(2);
    const updated = batches.at(-1)![0]!.price;
    // random=0.5 — цена не должна улететь: отклонение в пределах 1%
    expect(Math.abs(updated - initial) / initial).toBeLessThan(0.01);
  });

  it('после disconnect тики прекращаются', () => {
    const driver = createMockDriver();
    const batches: Quote[][] = [];

    driver.subscribe(['EURUSD']);
    driver.connect(
      (b) => batches.push(b),
      () => {},
    );
    vi.advanceTimersByTime(500);
    const countAfterConnect = batches.length;

    driver.disconnect();
    vi.advanceTimersByTime(5_000);
    expect(batches.length).toBe(countAfterConnect);
  });
});
