import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { poolOptions } from '@broker/config/vitest-pool.js';

export default defineConfig({
  plugins: [react()],
  test: {
    // Ограничение пула — общее для всех пакетов (WEB-37).
    poolOptions,
    environment: 'jsdom',
    // globals: RTL использует глобальный afterEach для авто-cleanup
    globals: true,
    include: ['src/**/*.test.tsx', 'src/**/*.test.ts'],
  },
});
