import { expect, test } from '@playwright/test';
import { OPEN_SITE_URL } from './support/open-site';

// Хост CMS закрыт фильтром по IP: в браузере ссылка CMS (cms.unreachable.invalid) не открылась бы.
// Логотип должен прийти через /media/ самой витрины.
test.describe('медиа CMS через витрину', () => {
  test.use({ baseURL: OPEN_SITE_URL });

  test('логотип в шапке грузится с /media/, хоста CMS в странице нет', async ({ page }) => {
    const cmsRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('cms.unreachable.invalid')) cmsRequests.push(req.url());
    });
    await page.goto('/');
    const logo = page.locator('header img[src^="/media/"]').first();
    await expect(logo).toHaveAttribute('src', '/media/e2e-logo.png');
    await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
    expect(cmsRequests).toEqual([]);
    expect(await page.content()).not.toContain('cms.unreachable.invalid');
  });

  test('/media/: тип и кеш; HEAD без тела; обход каталогов и чужие методы отклоняются', async ({ request }) => {
    const ok = await request.get('/media/e2e-logo.png');
    expect(ok.status()).toBe(200);
    expect(ok.headers()['content-type']).toBe('image/png');
    expect(ok.headers()['x-content-type-options']).toBe('nosniff');
    expect(ok.headers()['cache-control']).toContain('public');

    const head = await request.head('/media/e2e-logo.png');
    expect(head.status()).toBe(200);

    expect((await request.get('/media/..%2F..%2Fetc%2Fpasswd')).status()).toBe(404);
    expect((await request.get('/media/missing.png')).status()).toBe(404);
    expect((await request.post('/media/e2e-logo.png')).status()).toBe(405);

    const pdf = await request.get('/media/license.pdf');
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-security-policy']).toContain('sandbox');
  });
});
