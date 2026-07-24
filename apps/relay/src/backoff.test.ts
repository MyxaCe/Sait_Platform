import { describe, expect, it } from 'vitest';
import { MAX_DELAY_MS, nextDelayMs } from './backoff';

describe('nextDelayMs', () => {
  it('растёт экспоненциально: 5s → 25s → 125s', () => {
    expect(nextDelayMs(1)).toBe(5_000);
    expect(nextDelayMs(2)).toBe(25_000);
    expect(nextDelayMs(3)).toBe(125_000);
  });

  it('упирается в потолок 1 час', () => {
    expect(nextDelayMs(10)).toBe(MAX_DELAY_MS);
    expect(nextDelayMs(100)).toBe(MAX_DELAY_MS);
  });
});
