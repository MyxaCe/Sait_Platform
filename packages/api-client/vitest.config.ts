import { defineConfig } from 'vitest/config';
import { poolOptions } from '@broker/config/vitest-pool.js';

export default defineConfig({
  test: {
    poolOptions,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
