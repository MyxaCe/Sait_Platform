import { expect, test } from '@playwright/test';

/**
 * Сквозной SSO-handoff в терминал (ADR-023, совместный прогон):
 * регистрация → /trade → iframe терминала → postMessage sso.token →
 * терминал валидирует JWT по JWKS и чеканит сессию (POST /v1/session 2xx).
 * Требует: кабинет (:3002), терминал (:8888) с SSO_DISABLED=0.
 * Гейт: CABINET_URL + TERMINAL_URL.
 */
const CABINET = process.env.CABINET_URL;
const TERMINAL = process.env.TERMINAL_URL;

test.describe('SSO: кабинет → терминал', () => {
  test.skip(!CABINET || !TERMINAL, 'CABINET_URL/TERMINAL_URL не заданы');

  test('handoff-токен превращается в сессию терминала', async ({ page }) => {
    // Свежий пользователь
    await page.goto(`${CABINET}/register`);
    await page.getByLabel(/имя/i).first().fill('ССО');
    await page.getByLabel(/фамилия/i).fill('Прогонов');
    await page.getByLabel(/email/i).fill(`sso-e2e-${Date.now()}@example.com`);
    await page.getByLabel(/телефон/i).fill('+35725000002');
    await page.getByLabel(/страна/i).fill('Кипр');
    await page.getByLabel(/пароль/i).fill('secret1234!');
    await page.getByRole('button', { name: /открыть счёт/i }).click();
    await expect(page.getByText(/здравствуйте/i)).toBeVisible({ timeout: 15_000 });

    // Дальше всё делает машина: iframe → sso.token → их /v1/session
    const tokenIssued = page.waitForResponse(
      (r) => r.url().includes('/api/sso/token') && r.request().method() === 'POST',
      { timeout: 20_000 },
    );
    const terminalSession = page.waitForResponse(
      (r) => r.url().startsWith(`${TERMINAL}/v1/session`) && r.request().method() === 'POST',
      { timeout: 20_000 },
    );

    await page.goto(`${CABINET}/trade`);

    const issued = await tokenIssued;
    expect(issued.status(), 'кабинет выпустил handoff-токен').toBe(200);

    const session = await terminalSession;
    expect(session.ok(), `терминал принял токен и открыл сессию (HTTP ${session.status()})`).toBe(true);
    // Дальше bearer используют только ТОРГОВЫЕ ручки терминала (просмотр публичен),
    // а сделки из этого теста не кликаем — UI терминала не наш контракт.
  });
});
