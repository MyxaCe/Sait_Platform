import { expect, test } from '@playwright/test';

test('включённый язык (de) открывается с префиксом и немецким интерфейсом', async ({ page }) => {
  const response = await page.goto('/de');
  expect(response?.status()).toBe(200);
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Konto eröffnen' }).first()).toHaveAttribute('href', /\/de\/register/);
});

test('язык, не включённый для сайта (fr), — 404 без подмены', async ({ page }) => {
  const response = await page.goto('/fr');
  expect(response?.status()).toBe(404);
  const nested = await page.goto('/fr/instruments');
  expect(nested?.status()).toBe(404);
});

test('прежние адреса не изменились: ru без префикса, en — /en', async ({ page }) => {
  expect((await page.goto('/'))?.status()).toBe(200);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  expect((await page.goto('/en'))?.status()).toBe(200);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  const redirected = await page.goto('/ru/instruments');
  expect(new URL(page.url()).pathname).toBe('/instruments');
  expect(redirected?.status()).toBe(200);
});

test('переключатель: только языки сайта, самоназвания, та же страница, cookie NEXT_LOCALE', async ({ page, context }) => {
  await page.goto('/accounts');
  await page.getByRole('button', { name: 'Язык' }).filter({ visible: true }).click();
  const menu = page.getByRole('list', { name: 'Язык' }).filter({ visible: true });
  await expect(menu.getByRole('link')).toHaveText([/Русский/, /English/, /Deutsch/]);
  await menu.getByRole('link', { name: /Deutsch/ }).click();
  await expect(page).toHaveURL(/\/de\/accounts$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  const cookie = (await context.cookies()).find((c) => c.name === 'NEXT_LOCALE');
  expect(cookie?.value).toBe('de');
});
