import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { poolOptions } from '@broker/config/vitest-pool.js';

export default defineConfig({
  plugins: [react()],
  test: {
    poolOptions,
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.tsx', 'src/**/*.test.ts'],
  },
});
