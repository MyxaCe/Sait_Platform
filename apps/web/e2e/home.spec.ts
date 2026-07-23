import { expect, test } from '@playwright/test';

test('главная: hero, бегущая строка котировок и CTA', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Торгуйте на мировых рынках',
  );
  // Бегущая строка с котировками присутствует и содержит инструменты
  const ticker = page.getByLabel('Котировки в реальном времени');
  await expect(ticker).toBeVisible();
  await expect(ticker.getByText('EURUSD').first()).toBeVisible();

  // Главный CTA ведёт на регистрацию
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
  // Переключатель предлагает вернуться на русский
  await expect(page.getByRole('link', { name: /русск/i })).toBeVisible();
});

test('мобильное меню открывается и содержит навигацию', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Сценарий только для мобильного вьюпорта');
  await page.goto('/');

  await page.getByRole('button', { name: 'Открыть меню' }).click();
  const drawer = page.getByRole('navigation', { name: 'Мобильная навигация' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('link', { name: 'Счета и тарифы' })).toBeVisible();

  // Переход по пункту меню закрывает drawer и открывает страницу
  await drawer.getByRole('link', { name: 'Инструменты' }).click();
  await expect(page).toHaveURL(/\/instruments/);
});
