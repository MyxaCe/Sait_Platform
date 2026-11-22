import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { poolOptions } from '@broker/config/vitest-pool.js';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    poolOptions,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    environment: 'node',
    globals: true,
    environmentMatchGlobs: [['**/*.test.tsx', 'jsdom']],
    include: ['lib/**/*.test.ts', 'app/**/*.test.ts', 'app/**/*.test.tsx'],
  },
});
