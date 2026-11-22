import { expect, test } from '@playwright/test';
import { requireOrSkip } from './support/gates';

const CABINET = process.env.CABINET_URL;
const TERMINAL = process.env.TERMINAL_URL;
const GATED = !CABINET || !TERMINAL;

test.describe('SSO: кабинет → терминал', () => {
  requireOrSkip({
    gated: GATED,
    required: 'SSO_E2E_REQUIRED',
    what: 'сквозной вход',
    missing: 'CABINET_URL/TERMINAL_URL не заданы',
  });

  test('handoff-токен превращается в сессию терминала', async ({ page }) => {
    await page.goto(`${CABINET}/register`);
    await page.getByLabel(/имя/i).first().fill('ССО');
    await page.getByLabel(/фамилия/i).fill('Прогонов');
    await page.getByLabel(/email/i).fill(`sso-e2e-${Date.now()}@example.com`);
    await page.getByLabel(/телефон/i).fill('+35725000002');
    await page.getByLabel(/страна/i).fill('Кипр');
    await page.getByLabel(/пароль/i).fill('secret1234!');
    await page.getByRole('button', { name: /открыть счёт/i }).click();

    await expect(page, 'регистрация не увела с формы: сессия не создана').not.toHaveURL(
      /\/register/,
      { timeout: 15_000 },
    );

    await page.goto(`${CABINET}/trade`);

    const frame = page.locator('iframe');
    await expect(
      frame,
      'на странице торговли нет фрейма: адрес терминала не попал в сборку кабинета (WEB-19)',
    ).toHaveCount(1, { timeout: 15_000 });

    await expect(
      frame,
      'фрейм есть, но ведёт не на терминал — проверь NEXT_PUBLIC_TERMINAL_URL',
    ).toHaveAttribute('src', new RegExp(`^${TERMINAL}`));

    const issued = await page.waitForResponse(
      (r) => r.url().includes('/api/sso/token') && r.request().method() === 'POST',
      { timeout: 20_000 },
    );
    expect(issued.status(), 'кабинет не выпустил handoff-токен').toBe(200);

    const body = (await issued.json()) as { expiresIn?: unknown };
    expect(typeof body.expiresIn, 'в ответе кабинета нет срока жизни токена (CAB-07)').toBe(
      'number',
    );

    const session = await page.waitForResponse(
      (r) => r.url().startsWith(`${TERMINAL}/v1/session`) && r.request().method() === 'POST',
      { timeout: 20_000 },
    );
    expect(session.ok(), `терминал не принял токен (HTTP ${session.status()})`).toBe(true);
  });
});
