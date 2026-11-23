import { expect, test } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test('уведомление о cookie: честный текст, ссылка на политику, «Понятно» запоминается', async ({ page }) => {
  await page.goto('/');
  const notice = page.getByTestId('cookie-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(/только необходимые/i);
  await expect(notice.getByRole('link')).toHaveAttribute('href', /\/legal\/privacy$/);
  await notice.getByRole('button').click();
  await expect(notice).toBeHidden();
  await page.reload();
  await expect(page.getByTestId('cookie-notice')).toHaveCount(0);
});
