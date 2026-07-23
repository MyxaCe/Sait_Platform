import { expect, test } from '@playwright/test';

test('каталог: поиск фильтрует инструменты', async ({ page }) => {
  await page.goto('/instruments');

  await expect(
    page.getByRole('heading', { name: 'Торговые инструменты' }),
  ).toBeVisible();

  await page.getByLabel('Поиск инструмента').fill('EURUSD');
  await expect(page.getByText(/1 из \d+ инструментов/)).toBeVisible();

  // Фильтр по категории через чипы
  await page.getByLabel('Поиск инструмента').clear();
  await page.getByRole('button', { name: 'Криптовалюты' }).click();
  await expect(page.getByText(/5 из \d+ инструментов/)).toBeVisible();
});

test('страница инструмента: живая котировка Bid/Ask и условия', async ({ page }) => {
  await page.goto('/instruments/metals/xauusd');

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Gold');
  await expect(page.getByText('Bid')).toBeVisible();
  await expect(page.getByText('Ask')).toBeVisible();
  await expect(page.getByText('1:500', { exact: true })).toBeVisible();
});

test('неизвестный инструмент отдаёт 404', async ({ page }) => {
  const response = await page.goto('/instruments/forex/nosuchpair');
  expect(response?.status()).toBe(404);
});
