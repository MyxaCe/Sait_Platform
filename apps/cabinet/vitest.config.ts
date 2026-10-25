import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { poolOptions } from '@broker/config/vitest-pool.js';

/**
 * Зеркало `apps/web/vitest.config.ts`, включая компонентные проверки
 * (доделка WEB-42).
 *
 * **Почему появились здесь позже.** В кабинете тринадцать клиентских
 * компонентов, и ни один не был отрисовываем прогоном: окружение
 * `node`, в наборе только `.test.ts`. Ровно та дыра, которую WEB-16
 * закрыл в витрине, — и обнаружилась она, когда я добавил
 * четырнадцатый, чья работа как раз **показывать** исход действия.
 *
 * Узловые проверки остаются узловыми: браузерное окружение включается
 * только для `.test.tsx`.
 * Нужен ради алиаса `@` — без него
 * чистые модули из `features/` не импортируются в тестах, и проверка
 * переезжает в браузерный харнесс, который перестают запускать.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    // Ограничение пула — общее для всех пакетов (WEB-37).
    poolOptions,
    environment: 'node',
    // RTL вешает авто-очистку на глобальный `afterEach`.
    globals: true,
    environmentMatchGlobs: [['**/*.test.tsx', 'jsdom']],
    // `app/**` — ради CAB-02: барьеры выпуска SSO-токена (живая сессия,
    // rate limit, ненастроенность) стоят в ручке, а не в `lib`. Пока
    // прогон их не видел, проверка, отключённая в том режиме, где идут
    // тесты, не существовала.
    include: [
      'features/**/*.test.ts',
      'lib/**/*.test.ts',
      'app/**/*.test.ts',
      'features/**/*.test.tsx',
      'app/**/*.test.tsx',
    ],
  },
});
