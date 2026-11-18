import { expect, test } from '@playwright/test';

const STUB = `http://127.0.0.1:${process.env.CMS_STUB_PORT || '55493'}`;

test('контент — из CMS, а граница доступа закрыта без карточки сайта', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Торгуйте на мировых рынках',
  );
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
  expect([401, 503]).toContain(response.status());
  expect(await response.json()).toHaveProperty('error');
});

test('прогрев без подписи не принимается', async ({ request }) => {
  const response = await request.post('/api/revalidate/all', {
    data: { event_id: '00000000-0000-4000-8000-000000000000', issued_at: new Date().toISOString() },
  });
  expect([401, 503]).toContain(response.status());
});
