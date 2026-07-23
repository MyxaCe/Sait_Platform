import { describe, expect, it } from 'vitest';
import { isRateLimited } from './rate-limit';

describe('isRateLimited', () => {
  it('пропускает первые max запросов и блокирует следующий', () => {
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 5; i++) {
      expect(isRateLimited(key, { max: 5 })).toBe(false);
    }
    expect(isRateLimited(key, { max: 5 })).toBe(true);
  });

  it('лимиты по разным ключам независимы', () => {
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    for (let i = 0; i < 5; i++) isRateLimited(a, { max: 5 });
    expect(isRateLimited(a, { max: 5 })).toBe(true);
    expect(isRateLimited(b, { max: 5 })).toBe(false);
  });

  it('окно истекает — запросы снова проходят', () => {
    const key = `w-${Math.random()}`;
    for (let i = 0; i < 3; i++) isRateLimited(key, { max: 2, windowMs: 1 });
    // после истечения окна в 1 мс счётчик обнуляется
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(isRateLimited(key, { max: 2, windowMs: 1 })).toBe(false);
        resolve();
      }, 10);
    });
  });
});
