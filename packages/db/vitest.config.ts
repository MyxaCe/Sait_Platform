import { poolOptions } from '@broker/config/vitest-pool.js';
import { defineConfig } from 'vitest/config';

/**
 * У пакета есть свой файл настройки только ради общего ограничения
 * пула (WEB-37): на умолчаниях он поднимал бы `ядра − 1` потока и
 * перегружал бы машину наравне с остальными.
 */
export default defineConfig({
  test: {
    // Ограничение пула — общее для всех пакетов (WEB-37).
    poolOptions,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
