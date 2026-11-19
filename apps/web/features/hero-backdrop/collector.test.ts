import { describe, expect, it } from 'vitest';
import { collect, createCollector, drawable } from './collector';

const quote = (price: number, ts: number) => ({ price, ts });

describe('сбор точек из котировок', () => {
  it('живой фид: новая котировка — новая точка, повтор того же чтения — нет', () => {
    const c = createCollector();
    expect(collect(c, 'connected', { BTCUSD: quote(100, 1) }, ['BTCUSD'], 1_000)).toBe(1);
    expect(collect(c, 'connected', { BTCUSD: quote(100, 1) }, ['BTCUSD'], 2_000)).toBe(0);
    expect(collect(c, 'connected', { BTCUSD: quote(101, 2) }, ['BTCUSD'], 3_000)).toBe(1);
    expect(c.series.get('BTCUSD')!.samples).toEqual([
      { t: 1_000, p: 100 },
      { t: 3_000, p: 101 },
    ]);
  });

  it('стартовый снапшот (ts = 0) — не цена, точки нет', () => {
    const c = createCollector();
    expect(collect(c, 'connected', { BTCUSD: quote(100, 0) }, ['BTCUSD'], 1_000)).toBe(0);
    expect(drawable(c, 'connected', ['BTCUSD'])).toEqual([]);
  });

  it('берёт только свои символы', () => {
    const c = createCollector();
    collect(c, 'connected', { BTCUSD: quote(1, 1), ETHUSD: quote(2, 1) }, ['ETHUSD'], 1_000);
    expect([...c.series.keys()]).toEqual(['ETHUSD']);
  });
});

describe('без живого фида линий нет', () => {
  it.each(['simulated', 'offline', 'connecting'] as const)(
    '%s: котировки мок-драйвера не становятся точками',
    (status) => {
      const c = createCollector();
      expect(collect(c, status, { BTCUSD: quote(100, 5) }, ['BTCUSD'], 1_000)).toBe(0);
      expect(drawable(c, status, ['BTCUSD'])).toEqual([]);
    },
  );

  it('фид пропал — накопленное сбрасывается и не рисуется', () => {
    const c = createCollector();
    collect(c, 'connected', { BTCUSD: quote(100, 1) }, ['BTCUSD'], 1_000);
    expect(drawable(c, 'connected', ['BTCUSD'])).toHaveLength(1);
    expect(drawable(c, 'offline', ['BTCUSD'])).toEqual([]);
    collect(c, 'offline', { BTCUSD: quote(100, 1) }, ['BTCUSD'], 2_000);
    expect(c.series.size).toBe(0);
    expect(drawable(c, 'connected', ['BTCUSD'])).toEqual([]);
  });
});
