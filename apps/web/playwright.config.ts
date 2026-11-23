import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { E2E_FEED_URL, OPEN_SITE_PORT } from './e2e/support/open-site';

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
    // Уведомление о cookie закрыто заранее: оно прибито к низу экрана и на
    // мобильном перекрывает кнопки. Само уведомление — в cookie-notice.spec.ts.
    storageState: {
      cookies: [],
      origins: [`http://localhost:${PORT}`, `http://localhost:${OPEN_SITE_PORT}`].map((origin) => ({
        origin,
        localStorage: [{ name: 'cookie-notice-v1', value: '1' }],
      })),
    },
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
      command: process.env.CI ? `pnpm exec next start -H localhost -p ${PORT}` : `pnpm exec next dev -H localhost -p ${PORT}`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      env: {
        CMS_API_URL: `http://127.0.0.1:${STUB_PORT}/v1`,
        SITE_SLUG: 'e2e',
        CABINET_INTERNAL_URL: `http://127.0.0.1:${STUB_PORT}`,
        CMS_LAST_GOOD_DIR: path.join(tmpdir(), `web-e2e-cms-last-good-${PORT}`),
        NEXT_PUBLIC_WS_URL: E2E_FEED_URL,
        STATUS_PROMETHEUS_URL: `http://127.0.0.1:${STUB_PORT}`,
      },
      timeout: process.env.CI ? 120_000 : 300_000,
    },
    {
      command: `pnpm exec next start -H localhost -p ${OPEN_SITE_PORT}`,
      url: `http://localhost:${OPEN_SITE_PORT}`,
      reuseExistingServer: !process.env.CI,
      env: {
        CMS_API_URL: `http://127.0.0.1:${STUB_PORT}/v1`,
        SITE_SLUG: 'e2e-open',
        CABINET_INTERNAL_URL: `http://127.0.0.1:${STUB_PORT}`,
        MDS_HTTP_URL: `http://127.0.0.1:${STUB_PORT}`,
        NEXT_PUBLIC_WS_URL: E2E_FEED_URL,
        CMS_LAST_GOOD_DIR: path.join(tmpdir(), `web-e2e-cms-last-good-${OPEN_SITE_PORT}`),
      },
      timeout: 120_000,
    },
  ],
});
