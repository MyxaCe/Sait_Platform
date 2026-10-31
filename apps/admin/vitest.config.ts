import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { poolOptions } from '@broker/config/vitest-pool.js';

/**
 * Зеркало `apps/cabinet/vitest.config.ts`. Нужен ради алиаса `@` — без него
 * модули `lib/` не импортируются в тестах. Браузерное окружение включается
 * только для `.test.tsx`; каркас пока проверяет только гейт (`.test.ts`).
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    poolOptions,
    environment: 'node',
    globals: true,
    environmentMatchGlobs: [['**/*.test.tsx', 'jsdom']],
    include: ['lib/**/*.test.ts', 'app/**/*.test.ts', 'app/**/*.test.tsx'],
  },
});
