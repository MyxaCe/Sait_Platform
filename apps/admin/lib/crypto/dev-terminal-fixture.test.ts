import { afterEach, describe, expect, it, vi } from 'vitest';
import { devFixtureAccounts, devTerminalFixtureEnabled } from './dev-terminal-fixture';

describe('dev-фикстура терминала — fail-closed', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('выключена в production даже с флагом', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ADMIN_DEV_TERMINAL_FIXTURE', '1');
    expect(devTerminalFixtureEnabled()).toBe(false);
    await expect(devFixtureAccounts('x')).resolves.toEqual({
      state: 'unavailable',
      reason: 'not-configured',
    });
  });

  it('выключена в development без флага', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ADMIN_DEV_TERMINAL_FIXTURE', '');
    expect(devTerminalFixtureEnabled()).toBe(false);
  });

  it('выключена в test с флагом', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('ADMIN_DEV_TERMINAL_FIXTURE', '1');
    expect(devTerminalFixtureEnabled()).toBe(false);
  });

  it('включена только при development + флаг', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ADMIN_DEV_TERMINAL_FIXTURE', '1');
    expect(devTerminalFixtureEnabled()).toBe(true);
  });
});
