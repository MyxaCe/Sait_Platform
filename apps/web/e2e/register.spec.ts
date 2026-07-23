import { expect, test } from '@playwright/test';

test('регистрация: клиентская валидация не пускает пустую форму', async ({ page }) => {
  await page.goto('/register');

  await page.getByRole('button', { name: 'Открыть счёт' }).click();

  // Ошибки появляются без запроса на сервер
  await expect(page.getByText('Минимум 2 символа').first()).toBeVisible();
  await expect(page.getByText('Некорректный email')).toBeVisible();
  await expect(page.getByText('Необходимо принять условия')).toBeVisible();
});

test('регистрация: успешная заявка через BFF', async ({ page }) => {
  await page.goto('/register?account=pro');

  await page.getByLabel('Имя').fill('Тест');
  await page.getByLabel('Фамилия').fill('Тестов');
  await page.getByLabel('Email').fill(`e2e-${Date.now()}@example.com`);
  await page.getByLabel('Телефон').fill('+7 900 123-45-67');
  await page.getByLabel('Страна проживания').selectOption('RU');
  await page.getByRole('checkbox').check();

  await page.getByRole('button', { name: 'Открыть счёт' }).click();

  await expect(page.getByText('Заявка принята')).toBeVisible({ timeout: 15_000 });
});
