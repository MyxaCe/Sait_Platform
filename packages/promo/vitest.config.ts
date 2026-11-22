import { poolOptions } from '@broker/config/vitest-pool.js';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    poolOptions,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
