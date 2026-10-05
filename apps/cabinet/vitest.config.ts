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
    include: ['features/**/*.test.ts', 'lib/**/*.test.ts'],
  },
});
