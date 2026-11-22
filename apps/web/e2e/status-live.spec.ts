import { expect, test } from '@playwright/test';

test('статус (ru): статус и uptime из мониторинга, работы из CMS, без проверки — «нет данных»', async ({ page }) => {
  expect((await page.goto('/status'))?.status()).toBe(200);
  const board = page.getByTestId('status-board');
  await expect(board).toHaveAttribute('data-mode', 'live');
  await expect(page.getByTestId('status-banner')).toHaveAttribute('data-banner', 'issues');

  const row = (name: string) => board.locator('li', { hasText: name });
  await expect(row('Сайт')).toContainText('Работает');
  await expect(row('Сайт')).toContainText(/uptime за 40 дней: 99,95\s?%/);
  await expect(row('Хранилища')).toContainText('Замедления');
  await expect(row('CMS')).toContainText('Обслуживание');
  await expect(row('CMS')).toContainText('Обновление CMS');
  await expect(row('Платежи')).toContainText('Нет данных');
  await expect(board).not.toContainText('99.92%');

  await expect(board.locator('article', { hasText: 'Задержка котировок' })).toContainText('Исправляем');
  await expect(board.locator('article', { hasText: 'Старый инцидент' })).toContainText('Решено');
});

test('статус (de): подписи периода и состояний на языке страницы', async ({ page }) => {
  expect((await page.goto('/de/status'))?.status()).toBe(200);
  const board = page.getByTestId('status-board');
  await expect(board.locator('li').first()).toContainText(/Verfügbarkeit \(40 Tage\): 99,95\s?%/);
  await expect(board).toContainText('Keine Daten');
  await expect(board).toContainText('Wird behoben');
});
