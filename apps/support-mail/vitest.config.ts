import { defineConfig } from 'vitest/config';
import { poolOptions } from '@broker/config/vitest-pool.js';

export default defineConfig({
  test: {
    // Ограничение пула — общее для всех пакетов (WEB-37).
    poolOptions,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
