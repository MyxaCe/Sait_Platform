import { expect, test } from '@playwright/test';
import { OPEN_SITE_URL } from './support/open-site';

test.use({ baseURL: OPEN_SITE_URL });

test('статус без мониторинга: всё из CMS, как раньше; плановые работы из CMS видны', async ({ page }) => {
  expect((await page.goto('/status'))?.status()).toBe(200);
  const board = page.getByTestId('status-board');
  await expect(board).toHaveAttribute('data-mode', 'legacy');
  const row = (name: string) => board.locator('li', { hasText: name });
  await expect(row('Платежи')).toContainText('Работает');
  await expect(row('Платежи')).toContainText('uptime 90 дн: 99.92%');
  await expect(row('CMS')).toContainText('Обслуживание');
  await expect(board).not.toContainText('Нет данных');
});
