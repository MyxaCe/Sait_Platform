import { describe, expect, it, vi } from 'vitest';
import { enrollmentGate } from './enrollment-gate';

describe('enrollmentGate (каркас защищённой зоны)', () => {
  it('2FA включена — пускаем', async () => {
    expect(await enrollmentGate('op', async () => true)).toBe('ok');
  });

  it('2FA не включена — на /enroll', async () => {
    expect(await enrollmentGate('op', async () => false)).toBe('enroll');
  });

  it('база не ответила — fail-closed «недоступно», без исключения', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const gate = await enrollmentGate('op', async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
    });
    expect(gate).toBe('unavailable');
    spy.mockRestore();
  });
});
