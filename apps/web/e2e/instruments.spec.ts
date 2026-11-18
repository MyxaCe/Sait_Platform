import { expect, test } from '@playwright/test';
import { requireOrSkip, skipAsOtherScenario } from './support/gates';

test.describe('Граница закрыта (CI: стаб CMS без карточки сайта)', () => {
  skipAsOtherScenario(Boolean(process.env.CMS_E2E), 'контур с живой CMS проверяется ниже');

  test('страница инструментов объясняет, почему списка нет, а не молчит', async ({ page }) => {
    await page.goto('/instruments');

    await expect(page.getByRole('heading', { name: 'Торговые инструменты' })).toBeVisible();

    const notice = page.getByTestId('access-notice').last();
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('недоступен');
    await expect(notice).toHaveAttribute('data-access-state', 'unavailable');
    await expect(notice).toHaveAttribute('data-access-reason', /^(http-error|not-configured)$/);

    await expect(page.getByText(/\d+ из \d+ инструментов/)).toHaveCount(0);
  });

  test('деталка не отдаёт 404 при недоступном списке — 404 соврал бы', async ({ page }) => {
    const response = await page.goto('/instruments/metals/xauusd');

    expect(response?.status()).toBe(200);
    await expect(page.getByTestId('access-notice').last()).toBeVisible();
    await expect(page.getByText('Bid')).toHaveCount(0);
  });

  test('тикер не исчезает молча — на его месте строка с причиной', async ({ page }) => {
    await page.goto('/');

    const strip = page.getByTestId('access-notice').first();
    await expect(strip).toBeVisible();
    await expect(strip).toContainText('не показываются');
  });

  test('неизвестный инструмент по-прежнему 404', async ({ page }) => {
    const response = await page.goto('/instruments/forex/nosuchpair');
    expect(response?.status()).toBe(404);
  });
});

test.describe('Граница открыта (живая CMS с непустым списком)', () => {
  requireOrSkip({
    gated: !process.env.CMS_E2E,
    required: 'CMS_E2E_REQUIRED',
    what: 'браузер инструментов с непустым списком',
    missing: 'CMS_E2E не задан: живой CMS с посаженным тенантом нет',
  });

  test('каталог: поиск фильтрует инструменты', async ({ page }) => {
    await page.goto('/instruments');

    await expect(page.getByRole('heading', { name: 'Торговые инструменты' })).toBeVisible();
    await expect(page.getByTestId('access-notice')).toHaveCount(0);

    await page.getByLabel('Поиск инструмента').fill('EURUSD');
    await expect(page.getByText(/1 из \d+ инструментов/)).toBeVisible();

    await page.getByLabel('Поиск инструмента').clear();
    await page.getByRole('button', { name: 'Криптовалюты' }).click();
    await expect(page.getByText(/\d+ из \d+ инструментов/)).toBeVisible();
  });

  test('страница инструмента: живая котировка Bid/Ask и условия', async ({ page }) => {
    await page.goto('/instruments/metals/xauusd');

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Gold');
    await expect(page.getByText('Bid')).toBeVisible();
    await expect(page.getByText('Ask')).toBeVisible();
    await expect(page.getByText('1:500', { exact: true })).toBeVisible();
  });
});
