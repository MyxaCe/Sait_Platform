import { poolOptions } from '@broker/config/vitest-pool.js';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    poolOptions,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
