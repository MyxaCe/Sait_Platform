import { defineConfig } from 'vitest/config';
import { poolOptions } from '@broker/config/vitest-pool.js';

export default defineConfig({
  test: {
    // Ограничение пула — общее для всех пакетов (WEB-37).
    poolOptions,
    // Холодный старт PGlite + все миграции под нагрузкой CI > дефолтных 5 с (10.11).
    testTimeout: 60_000,
    hookTimeout: 120_000,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
