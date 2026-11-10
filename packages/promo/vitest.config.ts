import { poolOptions } from '@broker/config/vitest-pool.js';
import { defineConfig } from 'vitest/config';

/**
 * Файл заведён ради общего ограничения пула (WEB-37) — как у всех пакетов,
 * иначе сторож прогона проверок красный: у каждого, кто запускает тесты,
 * файл обязан быть.
 */
export default defineConfig({
  test: {
    poolOptions,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
