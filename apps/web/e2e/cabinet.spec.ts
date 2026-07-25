import { expect, test } from '@playwright/test';

/**
 * Живой e2e кабинета (ADR-022). Гоняется против ОТДЕЛЬНО запущенного
 * кабинета: CABINET_URL=http://localhost:3002. Без переменной — скипается
 * (в CI кабинет пока не поднимается — задача в бэклоге).
 */
const CABINET = process.env.CABINET_URL;

test.describe('Личный кабинет', () => {
  test.skip(!CABINET, 'CABINET_URL не задан — кабинет не запущен');

  const email = `e2e-${Date.now()}@example.com`;
  const password = 'secret1234!';

  test('регистрация → дашборд → выход → вход', async ({ page }) => {
    // Регистрация = открытие счёта
    await page.goto(`${CABINET}/register`);
    await page.getByLabel(/имя/i).first().fill('Тест');
    await page.getByLabel(/фамилия/i).fill('Кабинетов');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/телефон/i).fill('+35725000001');
    await page.getByLabel(/страна/i).fill('Кипр');
    await page.getByLabel(/пароль/i).fill(password);
    await page.getByRole('button', { name: /открыть счёт/i }).click();

    // Модульная главная (ADR-026): профиль (имя+UID), баланс, онбординг
    await expect(page.getByText('Тест Кабинетов').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/UID\s*\d{6}/).first()).toBeVisible();
    await expect(page.getByText(/10\s*000/).first()).toBeVisible();
    await expect(page.getByText(/пройти верификацию/i)).toBeVisible();

    // Уведомление welcome — непрочитанное
    await page.goto(`${CABINET}/notifications`);
    await expect(page.getByText(/добро пожаловать/i)).toBeVisible();

    // Выход
    await page.getByRole('button', { name: /выйти/i }).first().click();
    await expect(page).toHaveURL(/\/login/);

    // Логин-гейт: защищённая страница недоступна
    await page.goto(`${CABINET}/profile`);
    await expect(page).toHaveURL(/\/login/);

    // Неверный пароль
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/пароль/i).fill('wrong-password');
    await page.getByRole('button', { name: /войти/i }).click();
    await expect(page.getByText(/неверный email или пароль/i)).toBeVisible();

    // Верный вход
    await page.getByLabel(/пароль/i).fill(password);
    await page.getByRole('button', { name: /войти/i }).click();
    await expect(page.getByText('Тест Кабинетов').first()).toBeVisible({ timeout: 15_000 });

    // Повторная регистрация того же email — ошибка emailExists
    await page.getByRole('button', { name: /выйти/i }).first().click();
    await expect(page).toHaveURL(/\/login/); // дождаться логаута до перехода
    await page.goto(`${CABINET}/register`);
    await page.getByLabel(/имя/i).first().fill('Тест');
    await page.getByLabel(/фамилия/i).fill('Кабинетов');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/телефон/i).fill('+35725000001');
    await page.getByLabel(/страна/i).fill('Кипр');
    await page.getByLabel(/пароль/i).fill(password);
    await page.getByRole('button', { name: /открыть счёт/i }).click();
    await expect(page.getByText(/уже существует/i)).toBeVisible();
  });
});
