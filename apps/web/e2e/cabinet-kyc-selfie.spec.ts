import { expect, test, type Page } from '@playwright/test';
import { requireOrSkip } from './support/gates';
import { confirmRegistration } from './support/activation';

const CABINET = process.env.CABINET_URL;

test.use({
  permissions: ['camera'],
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
});

async function register(page: Page) {
  await page.goto(`${CABINET}/register`);
  await page.getByLabel(/имя/i).first().fill('Селфи');
  await page.getByLabel(/фамилия/i).fill('Камерова');
  const email = `kyc-selfie-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/телефон/i).fill('+35725000003');
  await page.getByLabel(/страна/i).fill('Кипр');
  await page.getByLabel(/пароль/i).fill('secret1234!');
  await page.locator('#consent').check();
  await page.getByRole('button', { name: /открыть счёт/i }).click();
  await confirmRegistration(page, email);
}

test.describe('KYC: селфи с камеры', () => {
  requireOrSkip({
    gated: !CABINET,
    required: 'CABINET_E2E_REQUIRED',
    what: 'селфи с камеры в кабинете',
    missing: 'CABINET_URL не задан — кабинет не запущен',
  });

  test('без камеры — сообщение и QR; с камерой — шаги «Документ → Адрес → Селфи» и снимки по заданию', async ({ page }) => {
    await page.addInitScript(() => {
      const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = (c) =>
        sessionStorage.getItem('e2e-deny-camera') === '1'
          ? Promise.reject(new DOMException('denied', 'NotAllowedError'))
          : real(c);
    });
    await register(page);

    await page.goto(`${CABINET}/profile?tab=verification&step=selfie_liveness`);
    await page.evaluate(() => sessionStorage.setItem('e2e-deny-camera', '1'));
    await page.reload();
    const step = page.getByTestId('kyc-step-selfie_liveness');
    await step.getByRole('button', { name: 'Включить камеру' }).click();
    await expect(step.getByText(/Нет доступа к камере/)).toBeVisible();
    await expect(step.getByRole('img', { name: /QR-код/ })).toBeVisible();
    await expect(step.getByText(/Сделайте этот шаг с телефона/)).toBeVisible();
    await page.evaluate(() => sessionStorage.removeItem('e2e-deny-camera'));

    await page.goto(`${CABINET}/profile?tab=verification`);
    const steps = page.getByRole('list', { name: 'Шаги верификации' });
    await expect(steps.getByRole('link')).toHaveText([/Документ/, /Адрес/, /Селфи/]);
    await expect(page.getByText(/Ориентировочный срок проверки/)).toBeVisible();

    await steps.getByRole('link', { name: /Селфи/ }).click();
    await expect(step).toBeVisible();
    await expect(step.locator('input[type="file"]')).toHaveCount(0);

    await step.getByRole('button', { name: 'Включить камеру' }).click();
    await expect(step.getByTestId('selfie-task')).toBeVisible({ timeout: 15_000 });
    await expect(step.getByText(/^Код \d{4}$/)).toBeVisible();

    for (let i = 1; i <= 3; i++) {
      await expect(step.getByText(`Снимок ${i} из 3`)).toBeVisible();
      await expect
        .poll(() => step.locator('video').evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 10_000 })
        .toBeGreaterThan(0);
      await step.getByRole('button', { name: 'Сделать снимок' }).click();
    }
    await expect(step.getByRole('img')).toHaveCount(3);
    await step.getByRole('button', { name: 'Отправить на проверку' }).click();
    await expect(step.getByText(/Снимки отправлены/)).toBeVisible({ timeout: 15_000 });

    await expect(page.getByText('На рассмотрении').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('listitem').filter({ hasText: 'Селфи с камеры' }).first()).toBeVisible();
  });
});
