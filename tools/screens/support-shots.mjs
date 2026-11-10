// Скрины модуля «Поддержка» (ветка demo-support) — вызывается из shoot.mjs:
//   node tools/screens/shoot.mjs <outDir> --set support
// Нужны: seed:demo + seed:support-demo на локальной базе; админка, кабинет
// (и витрина — WEB_URL, по умолчанию http://127.0.0.1:3487).
// Сцена §5 дизайна: оператор поддержки видит обращение без денег → отвечает
// шаблоном → клиент видит ответ и бейдж → «решено» → оценка.
import { join } from 'node:path';

const HERO_TICKET = '/support/1001';
const WEB = process.env.WEB_URL ?? 'http://127.0.0.1:3487';

async function go(page, url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 180_000 });
      break;
    } catch (e) {
      if (attempt === 2) throw e;
      await page.waitForTimeout(2000);
    }
  }
  await page.waitForTimeout(500);
}

async function adminCtx(browser, ctxArgs, adminToken, ADMIN, role, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, locale: 'ru-RU' });
  await ctx.addCookies([{ name: 'admin_operator_session', value: await adminToken(role), url: ADMIN }]);
  return ctx;
}

export async function shootSupport(browser, { outDir, ADMIN, CABINET, adminToken, CABINET_TOKEN, only }) {
  const want = (k) => !only || only.includes(k);
  const shot = async (page, name, full = true) => {
    await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: full });
    console.log('ok', name);
  };

  // ── Админка до ответа: оператор поддержки (1440 и 1024) ──
  const adminSet = [
    ['s01-queue', 'support', '/support'],
    ['s02-ticket-chat-support-role', 'support', HERO_TICKET],
    ['s03-ticket-email-failed', 'support', '/support/1007'],
    ['s04-ticket-recovered-web-form', 'support', '/support/1009'],
    ['s05-ticket-escalated-note', 'support', '/support/1003'],
    ['s06-ticket-chat-operator-role', 'operator', HERO_TICKET],
    ['s07-settings', 'admin', '/support/settings'],
    ['s08-templates', 'admin', '/support/templates'],
    ['s09-dashboard', 'admin', '/'],
    ['s10-client-card-support-tab', 'admin', '/clients/00000000-0000-4000-8000-0000000c0001?tab=support'],
    ['s11-journal-support', 'admin', '/journal?subjectKind=support_ticket'],
    ['s12-support-role-rail-clients-redirect', 'support', '/clients'],
  ];
  for (const width of [1440, 1024]) {
    const ctxs = {};
    for (const [key, role, path] of adminSet) {
      if (!want(key)) continue;
      if (width === 1024 && ['s06-ticket-chat-operator-role', 's11-journal-support', 's12-support-role-rail-clients-redirect'].includes(key)) continue;
      ctxs[role] ??= await adminCtx(browser, null, adminToken, ADMIN, role, width);
      const page = await ctxs[role].newPage();
      await go(page, `${ADMIN}${path}`);
      await shot(page, `${key}-a${width}`);
      await page.close();
    }
    for (const c of Object.values(ctxs)) await c.close();
  }

  // ── Сцена: оператор поддержки отвечает шаблоном ──
  if (want('s13-reply')) {
    const ctx = await adminCtx(browser, null, adminToken, ADMIN, 'support', 1440);
    const page = await ctx.newPage();
    await go(page, `${ADMIN}${HERO_TICKET}`);
    await page.getByLabel('Шаблон').selectOption('kyc.docs');
    await page.waitForTimeout(200);
    await shot(page, 's13a-reply-template-filled-a1440');
    await page.getByRole('button', { name: 'Отправить в чат' }).click();
    await page.waitForTimeout(2500);
    await go(page, `${ADMIN}${HERO_TICKET}`);
    await shot(page, 's13b-reply-sent-a1440');
    await ctx.close();
  }

  // ── Кабинет: бейдж и диалог (390 и 1440) ──
  for (const [w, h, tag] of [[390, 844, 'm390'], [1440, 900, 'd1440']]) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: h },
      deviceScaleFactor: tag === 'm390' ? 2 : 1,
      isMobile: tag === 'm390',
      hasTouch: tag === 'm390',
      locale: 'ru-RU',
    });
    await ctx.addCookies([{ name: 'cabinet_session', value: CABINET_TOKEN, url: CABINET }]);
    const page = await ctx.newPage();
    if (want('c01-badge')) {
      await go(page, `${CABINET}/ru`);
      await shot(page, `c01-widget-badge-${tag}`, false);
    }
    if (want('c02-open')) {
      await go(page, `${CABINET}/ru`);
      await page.locator('button[aria-controls="support-panel"]').click();
      await page.waitForTimeout(1800);
      await shot(page, `c02-widget-open-reply-${tag}`, false);
    }
    await ctx.close();
  }

  // ── «Решено» → оценка в кабинете ──
  if (want('s14-resolve')) {
    const ctx = await adminCtx(browser, null, adminToken, ADMIN, 'support', 1440);
    const page = await ctx.newPage();
    await go(page, `${ADMIN}${HERO_TICKET}`);
    await page.getByLabel('Новый статус').selectOption('resolved');
    await page.getByRole('button', { name: 'Применить' }).click();
    await page.waitForTimeout(2500);
    await ctx.close();
    for (const [w, h, tag] of [[390, 844, 'm390'], [1440, 900, 'd1440']]) {
      const c = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: tag === 'm390' ? 2 : 1, isMobile: tag === 'm390', hasTouch: tag === 'm390', locale: 'ru-RU' });
      await c.addCookies([{ name: 'cabinet_session', value: CABINET_TOKEN, url: CABINET }]);
      const p = await c.newPage();
      await go(p, `${CABINET}/ru`);
      await p.locator('button[aria-controls="support-panel"]').click();
      await p.waitForTimeout(1800);
      await shot(p, `c03-widget-resolved-rate-${tag}`, false);
      await c.close();
    }
  }

  // ── Кабинет без входа: «Забыли пароль?» ──
  for (const [w, h, tag] of [[390, 844, 'm390'], [1440, 900, 'd1440']]) {
    if (!want('c04-forgot')) break;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: tag === 'm390' ? 2 : 1, isMobile: tag === 'm390', hasTouch: tag === 'm390', locale: 'ru-RU' });
    const page = await ctx.newPage();
    await go(page, `${CABINET}/login`);
    await shot(page, `c04-login-forgot-link-${tag}`, false);
    await go(page, `${CABINET}/forgot-password`);
    await page.locator('#email').fill('m.orlova@example.com');
    await page.getByRole('button', { name: 'Отправить ссылку' }).click();
    await page.waitForTimeout(1500);
    await shot(page, `c05-forgot-sent-${tag}`, false);
    await ctx.close();
  }

  // ── Витрина: кнопка «Поддержка» гостя → форма → номер обращения ──
  if (want('w01-site')) {
    for (const [w, h, tag] of [[390, 844, 'm390'], [1440, 900, 'd1440']]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: tag === 'm390' ? 2 : 1, isMobile: tag === 'm390', hasTouch: tag === 'm390', locale: 'ru-RU' });
      const page = await ctx.newPage();
      try {
        await go(page, `${WEB}/`);
        await shot(page, `w01-site-support-button-${tag}`, false);
        await go(page, `${WEB}/company/contacts#write-us`);
        await page.locator('#ct-name').fill('Гость Демо');
        await page.locator('#ct-email').fill(`guest.${tag}@client.example`);
        await page.locator('#ct-topic').selectOption('payments');
        await page.locator('#ct-message').fill('Подскажите, сколько идёт вывод USDT и есть ли комиссия?');
        await page.locator('form button[type="submit"]').click();
        await page.waitForTimeout(2500);
        await page.locator('#write-us').scrollIntoViewIfNeeded();
        await shot(page, `w02-site-form-ticket-number-${tag}`, false);
      } catch (e) {
        console.log('витрина недоступна:', e.message);
      }
      await ctx.close();
    }
  }
}
