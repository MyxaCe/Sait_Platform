import { expect, test } from '@playwright/test';

test('главная: hero и CTA, бегущей строки котировок нет', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Торгуйте на мировых рынках',
  );
  // Бегущую строку убрали 23.11 (решение владельца): при ~230 инструментах
  // она неслась так, что ничего не прочитать.
  await expect(page.getByLabel('Котировки в реальном времени')).toHaveCount(0);
  await expect(page.locator('.animate-ticker')).toHaveCount(0);

  await expect(
    page.getByRole('link', { name: 'Открыть счёт' }).first(),
  ).toHaveAttribute('href', /\/register/);
});

test('нет горизонтального скролла (mobile-first)', async ({ page }) => {
  await page.goto('/');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('английская локаль: /en отдаёт переведённый хром', async ({ page }) => {
  await page.goto('/en');

  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Trade global markets');
  await page.getByRole('button', { name: 'Language' }).filter({ visible: true }).click();
  await expect(page.getByRole('link', { name: /русск/i }).filter({ visible: true })).toBeVisible();
});

test('мобильное меню открывается и содержит навигацию', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Сценарий только для мобильного вьюпорта');
  await page.goto('/');

  await page.getByRole('button', { name: 'Открыть меню' }).click();
  const drawer = page.getByRole('navigation', { name: 'Мобильная навигация' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('link', { name: 'Счета и тарифы' })).toBeVisible();

  await drawer.getByRole('link', { name: 'Инструменты' }).click();
  await expect(page).toHaveURL(/\/instruments/);
});
