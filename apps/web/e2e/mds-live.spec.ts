import { expect, test } from '@playwright/test';
import { requireOrSkip } from './support/gates';

test.describe('Тикер сайта ← MDS', () => {
  requireOrSkip({
    gated: !process.env.MDS_E2E,
    required: 'MDS_E2E_REQUIRED',
    what: 'живой тикер из MDS',
    missing: 'MDS_E2E не задан',
  });

  test('тикер живой: крипта из MDS, статус онлайн', async ({ page }) => {
    await page.goto('/');

    const ticker = page.locator('.animate-ticker').first();

    await expect(ticker.getByText('BTCUSD').first()).toBeVisible({ timeout: 10_000 });
    await expect(ticker.getByText('EURUSD')).toHaveCount(0);
    await expect(ticker.getByText('XAUUSD')).toHaveCount(0);

    await expect(page.getByText(/онлайн/i).first()).toBeVisible({ timeout: 15_000 });

    await expect(ticker).toContainText(/\d{2}[\s,. ]\d{3}/, { timeout: 15_000 });
  });
});
