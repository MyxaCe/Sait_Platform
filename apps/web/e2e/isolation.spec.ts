import { expect, test } from '@playwright/test';

/**
 * Чеклист §9.3 брифа платформы: «сайт полностью работает при ВСЕХ
 * недоступных соседях (проверено тестом)».
 * В CI сервер запускается без DATABASE_URL, CMS_API_URL и BUS_URL —
 * т.е. буквально без единого соседа: контент — из фолбэк-слоя,
 * лиды — в локальное хранилище, шина не требуется (outbox доедет позже).
 *
 * **Поправка Р-025.** «Работает» перестало означать «показывает всё».
 * Контент деградирует мягко — фикстуры вместо CMS, это косметика. Доступ
 * к инструментам деградирует ЖЁСТКО — он заведён ради регуляторики, и
 * недоступность CMS не имеет права превращаться в разрешение. Поэтому
 * страницы живут, а список инструментов закрыт и объясняет себя.
 * Прежняя версия этого теста требовала ровно обратного и зеленела на
 * снятой границе.
 */

test('контент живёт без CMS/DB/шины, а граница доступа закрывается', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Торгуйте на мировых рынках',
  );

  // Фолбэк контента — мягкий: страница целиком из фикстур
  await page.goto('/instruments');
  await expect(page.getByRole('heading', { name: 'Торговые инструменты' })).toBeVisible();

  // Фолбэк границы доступа — жёсткий: ни одного инструмента, причина видна
  await expect(page.getByText(/\d+ из \d+ инструментов/)).toHaveCount(0);
  const notice = page.getByTestId('access-notice').last();
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute('data-access-state', 'unavailable');
  await expect(notice).toHaveAttribute('data-access-reason', 'not-configured');
});

test('приём лида не зависит от соседей — форма контактов проходит', async ({ page }) => {
  await page.goto('/company/contacts');
  await page.getByLabel('Имя').fill('Изоляция');
  await page.getByLabel('Email').fill(`isolation-${Date.now()}@example.com`);
  await page.getByLabel('Сообщение').fill('Проверка чеклиста §9.3: сайт работает без соседей.');
  await page.getByRole('button', { name: 'Отправить сообщение' }).click();
  await expect(page.getByText('Сообщение отправлено')).toBeVisible({ timeout: 15_000 });
});

test('вебхук деградирует управляемо, а не падает', async ({ request }) => {
  const response = await request.post('/api/revalidate', {
    data: { event_id: '00000000-0000-4000-8000-000000000000', tags: ['cms:brand'] },
  });
  // Без секрета → 503 (не сконфигурирован), с секретом → 401 (нет подписи).
  // В обоих случаях — контролируемый ответ, не 5xx-краш.
  expect([401, 503]).toContain(response.status());
  expect(await response.json()).toHaveProperty('error');
});
