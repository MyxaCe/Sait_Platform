import { expect, test } from '@playwright/test';

test('FAQ (ru): параметры платформы подставлены и отформатированы по-русски', async ({ page }) => {
  expect((await page.goto('/education/faq'))?.status()).toBe(200);
  const main = page.locator('main');
  await expect(main).toContainText('Минимальная сумма пополнения — 10 USDT. На демо-счёте 10 000 USD.');
  await expect(main).toContainText('Standard — до 1:20 (крипта — до 1:10), Pro — до 1:50.');
  await expect(main).toContainText(
    'Способ пополнения — USDT (TRC20). Вывод от 10 USDT, без верификации — до 5 %. Поддержка работает круглосуточно. —',
  );
  await expect(main).not.toContainText('{{');
});

test('FAQ (de): те же параметры в немецком формате', async ({ page }) => {
  expect((await page.goto('/de/education/faq'))?.status()).toBe(200);
  const main = page.locator('main');
  await expect(main).toContainText('Die Mindesteinzahlung beträgt 10 USDT. Das Demokonto enthält 10.000 USD.');
  await expect(main).toContainText('ohne Verifizierung bis 5 %. Der Support ist rund um die Uhr erreichbar.');
  await expect(main).not.toContainText('{{');
});

test('счета: тарифы из публичных портфелей в их порядке, тексты CMS по ключу', async ({ page }) => {
  await page.goto('/accounts');
  const cards = page.locator('[data-account-type]');
  await expect(cards).toHaveCount(3);
  expect(await cards.evaluateAll((els) => els.map((e) => e.getAttribute('data-account-type')))).toEqual([
    'standard',
    'pro',
    'enc_prime',
  ]);
  const pro = page.locator('[data-account-type="pro"]');
  await expect(pro).toContainText('Pro');
  await expect(pro).toContainText('1:50');
  await expect(pro).toContainText('E2E');
  await expect(page.locator('[data-account-type="enc_prime"]')).toContainText('ECN Prime');
  await expect(pro.getByRole('link')).toHaveAttribute('href', /\/register$/);
});

test('акции: набор из движка, тексты CMS по идентификатору, выключенная не показывается', async ({ page }) => {
  await page.goto('/promotions');
  const list = page.getByTestId('promotions');
  await expect(list.locator('[data-promotion]')).toHaveCount(1);
  await expect(list).toContainText('Кешбэк E2E');
  await expect(list).toContainText('Возврат до 5 % — E2E');
  await expect(list).not.toContainText('Акция, выключенная в движке');
});
