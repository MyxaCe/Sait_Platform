import { expect, test } from '@playwright/test';

/**
 * Живые котировки сайта из MDS (ADR-024). Гоняется против production-сборки
 * с NEXT_PUBLIC_WS_URL и работающим MDS: тикер показывает только реально
 * стримящиеся символы, статус соединения — онлайн, цена живая (не initial).
 * Гейт: MDS_E2E=1 (в CI MDS не поднимается — бэклог вместе с TD-013).
 */
test.describe('Тикер сайта ← MDS', () => {
  test.skip(!process.env.MDS_E2E, 'MDS_E2E не задан');

  test('тикер живой: крипта из MDS, статус онлайн', async ({ page }) => {
    await page.goto('/');

    // Структурный селектор ленты (кириллица в CSS-атрибутных селекторах ненадёжна)
    const ticker = page.locator('.animate-ticker').first();

    // В ЛЕНТЕ только стримящиеся символы (крипта); замерших мок-символов нет
    await expect(ticker.getByText('BTCUSD').first()).toBeVisible({ timeout: 10_000 });
    await expect(ticker.getByText('EURUSD')).toHaveCount(0);
    await expect(ticker.getByText('XAUUSD')).toHaveCount(0);

    // Соединение с MDS установлено
    await expect(page.getByText(/онлайн/i).first()).toBeVisible({ timeout: 15_000 });

    // Цена реальная (пятизначная у BTC с разделителем тысяч), а не initial-заглушка
    await expect(ticker).toContainText(/\d{2}[\s,. ]\d{3}/, { timeout: 15_000 });
  });
});
