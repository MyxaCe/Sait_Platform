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
    // Первый тест каждого файла поднимает PGlite (WASM) и прогоняет ВСЕ
    // миграции в шаблон. В одиночку ~2 с, под параллельной нагрузкой CI
    // (Linux runner, 17 пакетов разом) — >5 с: дефолтный таймаут краснил
    // прогон при зелёной логике (integration-demo3, 10.11). Лимит про
    // холодный старт базы, а не про медленную логику.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
