import { expect, test } from '@playwright/test';

const CABINET = (process.env.NEXT_PUBLIC_CABINET_URL || 'http://localhost:3002').replace(/\/$/, '');

test('старый /register витрины переадресует в регистрацию кабинета с тарифом', async ({ request }) => {
  const res = await request.get('/register?account=pro&promo=welcome', { maxRedirects: 0 });
  expect([307, 308]).toContain(res.status());
  expect(res.headers()['location']).toBe(`${CABINET}/register?accountType=pro&promo=welcome`);
});

test('/login витрины переадресует на вход кабинета', async ({ request }) => {
  const res = await request.get('/en/login', { maxRedirects: 0 });
  expect([307, 308]).toContain(res.status());
  expect(res.headers()['location']).toBe(`${CABINET}/en/login`);
});

test('sitemap больше не содержит /register', async ({ request }) => {
  const body = await (await request.get('/sitemap.xml')).text();
  expect(body).not.toMatch(/<loc>[^<]*\/register<\/loc>/);
});
