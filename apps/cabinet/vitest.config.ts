import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Зеркало `apps/web/vitest.config.ts`. Нужен ради алиаса `@` — без него
 * чистые модули из `features/` не импортируются в тестах, и проверка
 * переезжает в браузерный харнесс, который перестают запускать.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'node',
    // `app/**` — ради CAB-02: барьеры выпуска SSO-токена (живая сессия,
    // rate limit, ненастроенность) стоят в ручке, а не в `lib`. Пока
    // прогон их не видел, проверка, отключённая в том режиме, где идут
    // тесты, не существовала.
    include: ['features/**/*.test.ts', 'lib/**/*.test.ts', 'app/**/*.test.ts'],
  },
});
