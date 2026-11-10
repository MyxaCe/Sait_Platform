import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * Витрина в e2e поднимается со СТАБОМ CMS (`e2e/support/cms-stub.mjs`).
 * С 10.11 контента в коде нет: без CMS витрина честно отвечает «Контент
 * временно недоступен», и сценарии проверяли бы только заглушку.
 * Порты — переменными: локально 3000 часто занят.
 */
const PORT = process.env.E2E_PORT || '3000';
const STUB_PORT = process.env.CMS_STUB_PORT || '55493';

export default defineConfig({
  testDir: './e2e',
  /*
   * Межзонный сценарий входа сюда НЕ входит (разбор красной основной,
   * 24.10). Ему нужны кабинет и терминал — две чужие службы, которых в
   * этом прогоне нет и не будет: он поднимает одну витрину.
   *
   * У сценария свой конфиг (`playwright.sso.config.ts`) и своя команда
   * `test:e2e:sso`, которую гоняют, когда обе стороны подняты.
   *
   * Держать его здесь значило требовать от прогона того, чего он не
   * может дать, — а гейт, который невозможно удовлетворить, отключают.
   */
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
    // ~50% трафика — мобильные: гоняем те же сценарии на телефоне
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
      // CI: e2e гоняется против production-сборки (build уже выполнен шагом раньше)
      command: process.env.CI ? `pnpm exec next start -p ${PORT}` : `pnpm exec next dev -p ${PORT}`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      env: {
        CMS_API_URL: `http://127.0.0.1:${STUB_PORT}/v1`,
        SITE_SLUG: 'e2e',
        // Последняя версия ответов CMS — во временном каталоге прогона
        CMS_LAST_GOOD_DIR: path.join(tmpdir(), `web-e2e-cms-last-good-${PORT}`),
      },
      /*
       * В CI сервер уже собран (`next start`) и поднимается быстро. Локально
       * это ХОЛОДНЫЙ `next dev`, и в две минуты он не укладывается: прогон
       * падал с «Timed out waiting 120000ms from config.webServer», то есть
       * по причине, не имеющей отношения ни к одному проверяемому свойству.
       * Отказ, не относящийся к предмету проверки, — тоже мёртвый тест
       * (WEB-18).
       */
      timeout: process.env.CI ? 120_000 : 300_000,
    },
  ],
});
