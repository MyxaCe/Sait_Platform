import { expect, test } from '@playwright/test';
import { requireOrSkip } from './support/gates';

const CABINET = process.env.CABINET_URL;

// ТД-009 п.4: cookie сессии есть, а сессии в базе нет (выход на другом устройстве, блокировка).
// Раньше: / → /login (сессии нет) → / (middleware видит cookie) → … петля.
test.describe('Кабинет: погашенная сессия', () => {
  requireOrSkip({
    gated: !CABINET,
    required: 'CABINET_E2E_REQUIRED',
    what: 'погашенная сессия кабинета',
    missing: 'CABINET_URL не задан — кабинет не запущен',
  });

  test('чужая или погашенная cookie ведёт на вход без петли и стирается', async ({ page, context }) => {
    const url = new URL(CABINET!);
    await context.addCookies([{ name: 'cabinet_session', value: 'stale-token-that-does-not-exist', domain: url.hostname, path: '/' }]);

    const response = await page.goto(`${CABINET}/terminal?account=real&symbol=EURUSD`);
    expect(response?.status()).toBeLessThan(400);
    await expect(page).toHaveURL(/\/login/);
    expect(new URL(page.url()).searchParams.get('next')).toContain('symbol=EURUSD');

    const left = (await context.cookies()).find((c) => c.name === 'cabinet_session');
    expect(left?.value ?? '').toBe('');

    await page.goto(`${CABINET}/`);
    await expect(page).toHaveURL(/\/login/);
  });
});
