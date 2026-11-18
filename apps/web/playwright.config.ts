import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.E2E_PORT || '3000';
const STUB_PORT = process.env.CMS_STUB_PORT || '55493';

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['**/cabinet-sso.spec.ts'],
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'node e2e/support/cms-stub.mjs',
      url: `http://127.0.0.1:${STUB_PORT}/health`,
      env: { CMS_STUB_PORT: STUB_PORT },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: process.env.CI ? `pnpm exec next start -p ${PORT}` : `pnpm exec next dev -p ${PORT}`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      env: {
        CMS_API_URL: `http://127.0.0.1:${STUB_PORT}/v1`,
        SITE_SLUG: 'e2e',
        CMS_LAST_GOOD_DIR: path.join(tmpdir(), `web-e2e-cms-last-good-${PORT}`),
      },
      timeout: process.env.CI ? 120_000 : 300_000,
    },
  ],
});
