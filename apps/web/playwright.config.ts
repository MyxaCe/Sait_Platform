import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    // ~50% трафика — мобильные: гоняем те же сценарии на телефоне
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    // CI: e2e гоняется против production-сборки (build уже выполнен шагом раньше)
    command: process.env.CI ? 'pnpm start' : 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    /*
     * В CI сервер уже собран (`pnpm start`) и поднимается быстро. Локально
     * это ХОЛОДНЫЙ `next dev`, и в две минуты он не укладывается: прогон
     * падал с «Timed out waiting 120000ms from config.webServer», то есть
     * по причине, не имеющей отношения ни к одному проверяемому свойству.
     * Отказ, не относящийся к предмету проверки, — тоже мёртвый тест
     * (WEB-18).
     */
    timeout: process.env.CI ? 120_000 : 300_000,
  },
});
