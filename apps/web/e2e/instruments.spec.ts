import { expect, test } from '@playwright/test';

/**
 * Граница доступа витрины к инструментам (ADR-028) после решения Р-025 —
 * fail-closed: списка нет → не показываем ничего и говорим почему.
 *
 * **Почему спек разделён на два блока.** В CI сервер поднимается без
 * `CMS_API_URL`, то есть ровно в состоянии «списка нет». Это основной
 * сценарий, он гоняется всегда. Сценарии с НЕПУСТЫМ списком требуют живой
 * CMS с посаженным тенантом и гейтятся `CMS_E2E=1` — так же, как
 * `mds-live.spec.ts` гейтится `MDS_E2E`.
 *
 * Дыра названа вслух, а не закрыта на глаз: пока в CI нет стаба CMS,
 * браузер инструментов сквозным прогоном в CI не покрыт. Запрос на стаб —
 * в отчёте штабу; до тех пор разбор состояний закрыт юнит-тестами
 * `lib/tenant.test.ts`, а покрытие единицы покрытием пути не является.
 */

test.describe('Граница закрыта (CI: сайт без CMS)', () => {
  test.skip(Boolean(process.env.CMS_E2E), 'Контур с живой CMS — другой сценарий');

  test('страница инструментов объясняет, почему списка нет, а не молчит', async ({ page }) => {
    await page.goto('/instruments');

    // Заголовок на месте: страница не исчезла и не отдала 404
    await expect(page.getByRole('heading', { name: 'Торговые инструменты' })).toBeVisible();

    // На месте списка — объяснение, а не пустая таблица «0 из 0»
    const notice = page.getByTestId('access-notice').last();
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('недоступен');
    // «Пусто» и «недоступно» отличимы машиной, причина — тоже на экране
    await expect(notice).toHaveAttribute('data-access-state', 'unavailable');
    await expect(notice).toHaveAttribute('data-access-reason', 'not-configured');

    // Граница действительно не снята: счётчика инструментов нет вовсе
    await expect(page.getByText(/\d+ из \d+ инструментов/)).toHaveCount(0);
  });

  test('деталка не отдаёт 404 при недоступном списке — 404 соврал бы', async ({ page }) => {
    const response = await page.goto('/instruments/metals/xauusd');

    // «Списка нет» и «такого инструмента у нас нет» — разные ответы.
    // 404 на первом и был бы отказом, выглядящим как отсутствие функции.
    expect(response?.status()).toBe(200);
    await expect(page.getByTestId('access-notice').last()).toBeVisible();
    // Живой котировки при закрытой границе быть не должно
    await expect(page.getByText('Bid')).toHaveCount(0);
  });

  test('тикер не исчезает молча — на его месте строка с причиной', async ({ page }) => {
    await page.goto('/');

    const strip = page.getByTestId('access-notice').first();
    await expect(strip).toBeVisible();
    await expect(strip).toContainText('не показываются');
  });

  test('неизвестный инструмент по-прежнему 404', async ({ page }) => {
    // Символа нет в справочнике — отказ наступает ДО границы доступа,
    // и здесь 404 честен
    const response = await page.goto('/instruments/forex/nosuchpair');
    expect(response?.status()).toBe(404);
  });
});

test.describe('Граница открыта (живая CMS с непустым списком)', () => {
  test.skip(!process.env.CMS_E2E, 'CMS_E2E не задан: списка инструментов на контуре нет');

  test('каталог: поиск фильтрует инструменты', async ({ page }) => {
    await page.goto('/instruments');

    await expect(page.getByRole('heading', { name: 'Торговые инструменты' })).toBeVisible();
    await expect(page.getByTestId('access-notice')).toHaveCount(0);

    await page.getByLabel('Поиск инструмента').fill('EURUSD');
    await expect(page.getByText(/1 из \d+ инструментов/)).toBeVisible();

    // Фильтр по категории через чипы
    await page.getByLabel('Поиск инструмента').clear();
    await page.getByRole('button', { name: 'Криптовалюты' }).click();
    await expect(page.getByText(/\d+ из \d+ инструментов/)).toBeVisible();
  });

  test('страница инструмента: живая котировка Bid/Ask и условия', async ({ page }) => {
    await page.goto('/instruments/metals/xauusd');

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Gold');
    await expect(page.getByText('Bid')).toBeVisible();
    await expect(page.getByText('Ask')).toBeVisible();
    await expect(page.getByText('1:500', { exact: true })).toBeVisible();
  });
});
