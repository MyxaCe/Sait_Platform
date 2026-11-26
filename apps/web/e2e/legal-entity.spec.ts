import { expect, test } from '@playwright/test';
import { OPEN_SITE_URL } from './support/open-site';

test.describe('юрлицо не заполнено в CMS', () => {
  test('в подвале нет строк юрлица и лицензий, страницы «Регулирование» нет', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('footer')).toBeVisible();
    await expect(page.getByTestId('footer-legal')).toHaveCount(0);
    await expect(page.locator('footer')).not.toContainText(/Лицензия|рег\. №/);

    const res = await page.goto('/company/regulation');
    expect(res?.status()).toBe(404);
  });
});

test.describe('юрлицо и лицензии из CMS', () => {
  test.use({ baseURL: OPEN_SITE_URL });

  test('подвал: строка юрлица, лицензии и «Проверить лицензию» в новой вкладке', async ({ page }) => {
    await page.goto('/company/regulation');
    const legal = page.getByTestId('footer-legal');
    await expect(legal).toContainText('Example Ltd, рег. № EX-000000, Пример-сити, ул. Примерная, 1');
    await expect(legal).toContainText(
      'Лицензия № LIC-0001 (Брокерская деятельность), Example Financial Authority',
    );
    await expect(legal).toContainText('Лицензия № LIC-0002');
    const verify = legal.getByRole('link', { name: 'Проверить лицензию' });
    await expect(verify).toHaveCount(1);
    await expect(verify).toHaveAttribute('href', 'https://register.example.test/firms/LIC-0001');
    await expect(verify).toHaveAttribute('target', '_blank');
    await expect(verify).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(legal.getByRole('link', { name: 'Регулирование' })).toHaveAttribute(
      'href',
      /\/company\/regulation$/,
    );
  });

  test('страница «Регулирование»: подробно и ссылка на PDF', async ({ page }) => {
    const res = await page.goto('/company/regulation');
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Регулирование');
    const main = page.locator('main');
    await expect(main).toContainText('EX-000000');
    await expect(main).toContainText('Exampleland');
    await expect(main.getByTestId('regulation-license')).toHaveCount(2);
    await expect(main.getByRole('link', { name: 'Лицензия (PDF)' })).toHaveAttribute(
      'href',
      '/media/license.pdf',
    );
  });

  test('английская локаль: переведённые подписи и тексты из CMS', async ({ page }) => {
    await page.goto('/en/company/regulation');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Regulation');
    const legal = page.getByTestId('footer-legal');
    await expect(legal).toContainText('Licence No. LIC-0001 (Brokerage), Example Financial Authority');
    await expect(legal.getByRole('link', { name: 'Verify licence' })).toBeVisible();
  });
});
