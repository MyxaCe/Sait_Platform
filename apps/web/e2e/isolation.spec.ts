import { expect, test } from '@playwright/test';

/**
 * Чеклист §9.3 брифа платформы: «сайт работает при недоступных соседях».
 *
 * **Поправка 10.11 (решение владельца).** Контента в коде больше нет —
 * даже как запасного. «Работает без CMS» теперь значит: витрина
 * показывает ПОСЛЕДНИЙ удачный ответ CMS, а если его нет — честную
 * заглушку 503. Подмены фикстурами нет. Здесь сервер поднят со стабом
 * CMS (`e2e/support/cms-stub.mjs`), без БД и шины.
 *
 * Доступ к инструментам по-прежнему деградирует ЖЁСТКО (Р-025):
 * недоступность карточки сайта не превращается в разрешение.
 */

const STUB = `http://127.0.0.1:${process.env.CMS_STUB_PORT || '55493'}`;

test('контент — из CMS, а граница доступа закрыта без карточки сайта', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Торгуйте на мировых рынках',
  );
  // Бренд из CMS (стаб), а не из кода
  await expect(page.getByRole('link', { name: /E2E Brand/ }).first()).toBeVisible();

  await page.goto('/instruments');
  await expect(page.getByRole('heading', { name: 'Торговые инструменты' })).toBeVisible();
  await expect(page.getByText(/\d+ из \d+ инструментов/)).toHaveCount(0);
  const notice = page.getByTestId('access-notice').last();
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute('data-access-state', 'unavailable');
});

test('CMS упала → последняя версия её ответа, а не фикстуры и не 500', async ({
  page,
  request,
}) => {
  // Страница инструментов динамическая: каждый запрос заново спрашивает
  // CMS, поэтому это честная проверка пути «CMS не ответила».
  const first = await page.goto('/instruments');
  expect(first?.status()).toBe(200);

  await request.post(`${STUB}/__stub/down?resource=instruments`);
  try {
    const second = await page.goto('/instruments');
    expect(second?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Торговые инструменты' })).toBeVisible();
  } finally {
    await request.post(`${STUB}/__stub/up?resource=instruments`);
  }
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
  expect([401, 503]).toContain(response.status());
  expect(await response.json()).toHaveProperty('error');
});

test('прогрев без подписи не принимается', async ({ request }) => {
  const response = await request.post('/api/revalidate/all', {
    data: { event_id: '00000000-0000-4000-8000-000000000000', issued_at: new Date().toISOString() },
  });
  expect([401, 503]).toContain(response.status());
});
