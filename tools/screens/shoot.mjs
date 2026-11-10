// Скриншотер редизайна (dev-инструмент, НЕ продовый код).
//
// Снимает экраны админки (1440) и кабинета (390 + 1440) локального стенда.
// Админ-сессию выпускает сам: подписывает HS256 тем же ADMIN_SESSION_SECRET,
// что в apps/admin/.env.local (оператор с включённой 2FA засеян seed:demo).
// Кабинет — по сессии, засеянной seed:demo (cookie cabinet_session).
//
//   node tools/screens/shoot.mjs <outDir> [--set admin|cabinet|all] [--palette <name>] [--only key,key]
//   кабинет: [--cabinet-token <token>] (сессия другого клиента) [--suffix -frozen] [--sizes m390,d1440]
//
// Переменные: ADMIN_URL (http://localhost:3305), CABINET_URL (http://localhost:3302),
// ADMIN_SESSION_SECRET.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const reqWeb = createRequire(join(root, 'apps/web/package.json'));
const reqAdmin = createRequire(join(root, 'apps/admin/package.json'));
const { chromium } = reqWeb('@playwright/test');
const { SignJWT } = await import('file://' + reqAdmin.resolve('jose').replace(/\\/g, '/'));

const args = process.argv.slice(2);
const outDir = resolve(args[0] ?? 'screens-out');
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const set = opt('set', 'all');
const palette = opt('palette', null);
const only = opt('only', null)?.split(',');
const role = opt('role', 'admin');
const suffix = opt('suffix', '');
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:3305';
const CABINET = process.env.CABINET_URL ?? 'http://localhost:3302';
const SECRET = process.env.ADMIN_SESSION_SECRET ?? 'local-design-secret-not-for-prod-0123456789';
const HERO = '00000000-0000-4000-8000-0000000c0001';

const ROLES = {
  admin: { sub: '00000000-0000-4000-8000-00000000a001', login: 'i.kovaleva', name: 'Ирина Ковалёва', role: 'admin' },
  operator: { sub: '00000000-0000-4000-8000-00000000a002', login: 'd.sokolov', name: 'Дмитрий Соколов', role: 'operator' },
};

async function adminToken(who = 'admin') {
  const r = ROLES[who];
  return new SignJWT({ login: r.login, name: r.name, role: r.role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('platform-admin')
    .setAudience('admin-center')
    .setSubject(r.sub)
    .setIssuedAt()
    .setExpirationTime('2h')
    .sign(new TextEncoder().encode(SECRET));
}

const ADMIN_SHOTS = [
  ['01-dashboard', '/'],
  ['02-clients', '/clients'],
  ['03-client-card', `/clients/${HERO}`],
  ['03b-client-trading', `/clients/${HERO}?tab=trading`],
  ['03c-client-money', `/clients/${HERO}?tab=money`],
  ['03d-client-compliance', `/clients/${HERO}?tab=compliance`],
  ['03e-client-access', `/clients/${HERO}?tab=access`],
  ['03f-client-journal', `/clients/${HERO}?tab=journal`],
  ['03g-client-blocked', null], // заблокированный клиент (Marco Bianchi) — подставляется из реестра
  ['04-kyc', '/kyc'],
  ['05-kyc-card', null], // подставляется первым pending
  ['06-aml', '/aml'],
  ['07-aml-card', `/aml/${HERO}`],
  ['08-money', '/money'],
  ['09-settings', '/settings'],
  ['10-operators', '/operators'],
  ['11-journal', '/journal'],
  ['12-risk-leverage', '/risk/leverage'],
  ['13-risk-portfolios', '/risk/portfolios'],
  ['13b-risk-portfolio-edit', '/risk/portfolios?edit=standard'],
  ['14-login', '/login'],
  // Акции и партнёры (ДЕМО-акции, 10.11). null-пути подставляются ниже.
  ['20-promo', '/promo'],
  ['21-promo-card', null],
  ['21b-promo-card-edit', null],
  ['22-promo-new', '/promo/new'],
  ['23-promo-queue', null],
  ['24-promo-contests', '/promo/contests'],
  ['24b-promo-contest-final', null],
  ['25-promo-referrals', null],
  ['26-promo-partners', null],
];

/** Подстановка путей экранов акций: первая подходящая ссылка со страницы-списка. */
const PROMO_PICK = {
  '21-promo-card': ['/promo', 'a:has-text("Бонус 30%")', ''],
  '21b-promo-card-edit': ['/promo', 'a:has-text("Бонус на повторное")', '?edit=1'],
  '23-promo-queue': ['/promo/queue', 'tr:has-text("Реферал") a:has-text("Игорь Смирнов")', ''],
  '24b-promo-contest-final': ['/promo/contests', 'a:has-text("октябрь")', ''],
  '25-promo-referrals': ['/promo/referrals', 'a[href*="/promo/referrals?a="]:has-text("Анна Белова")', ''],
  '26-promo-partners': ['/promo/partners', 'a:has-text("Fischer Capital")', ''],
};

const CABINET_SHOTS = [
  ['c01-home', '/ru'],
  ['c02-trade', '/ru/trade'],
  ['c03-terminal', '/ru/terminal?account=real'],
  ['c04-wallet-deposit', '/ru/wallet'],
  ['c05-wallet-withdraw', '/ru/wallet?tab=withdraw'],
  // Вывод: шаг подтверждения (адрес и сумма заполнены, «Продолжить»).
  ['c06-withdraw-confirm', '/ru/wallet?tab=withdraw', { fill: true }],
  ['c07-history', '/ru/history'],
  ['c08-history-demo', '/ru/history?account=demo&period=all'],
  ['c09-history-money', '/ru/history?account=real&type=money&period=90d'],
  ['c10-profile', '/ru/profile'],
  ['c11-profile-verification', '/ru/profile?tab=verification'],
  ['c12-profile-security', '/ru/profile?tab=security'],
  ['c13-profile-documents', '/ru/profile?tab=documents'],
  // Нижняя навигация телефона: открытая шторка «Ещё» (только m390).
  ['c14-more', '/ru', { mobileOnly: true, click: 'nav[aria-label] button[aria-haspopup="dialog"]' }],
];
const CABINET_TOKEN = opt('cabinet-token', 'demo-cabinet-token-0001');
const SIZES = opt('sizes', 'm390,d1440').split(',');

async function shootAdmin(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'ru-RU' });
  const token = await adminToken(role);
  await ctx.addCookies([{ name: 'admin_operator_session', value: token, url: ADMIN }]);
  if (palette) await ctx.addCookies([{ name: 'adm_palette', value: palette, url: ADMIN }]);
  const page = await ctx.newPage();
  for (const [key, path0] of ADMIN_SHOTS) {
    if (only && !only.includes(key)) continue;
    let path = path0;
    if (key === '14-login') {
      await ctx.clearCookies();
      if (palette) await ctx.addCookies([{ name: 'adm_palette', value: palette, url: ADMIN }]);
    }
    if (path === null && key === '03g-client-blocked') {
      await page.goto(`${ADMIN}/clients?q=bianchi`, { waitUntil: 'networkidle' });
      const href = await page.locator('a[href^="/clients/"]').first().getAttribute('href').catch(() => null);
      if (!href) continue;
      path = href;
    }
    if (path === null && PROMO_PICK[key]) {
      const [list, sel, suffixQ] = PROMO_PICK[key];
      await page.goto(`${ADMIN}${list}`, { waitUntil: 'networkidle', timeout: 120_000 });
      const href = await page.locator(sel).first().getAttribute('href').catch(() => null);
      if (!href) continue;
      path = href.split('#')[0] + suffixQ;
    }
    if (path === null) {
      await page.goto(`${ADMIN}/kyc`, { waitUntil: 'networkidle' });
      const href = await page.locator('a[href^="/kyc/"]').first().getAttribute('href').catch(() => null);
      if (!href) continue;
      path = href;
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await page.goto(`${ADMIN}${path}`, { waitUntil: 'networkidle', timeout: 120_000 });
        break;
      } catch (e) {
        if (attempt === 2) throw e;
        await page.waitForTimeout(2000);
      }
    }
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(outDir, `${key}${suffix}.png`), fullPage: true });
    console.log('ok', key);
  }
  await ctx.close();
}

async function shootCabinet(browser) {
  for (const [w, h, tag] of [[390, 844, 'm390'], [1440, 900, 'd1440']]) {
    if (!SIZES.includes(tag)) continue;
    const ctx = await browser.newContext({
      viewport: { width: w, height: h },
      deviceScaleFactor: tag === 'm390' ? 2 : 1,
      isMobile: tag === 'm390',
      hasTouch: tag === 'm390',
      locale: 'ru-RU',
    });
    await ctx.addCookies([{ name: 'cabinet_session', value: CABINET_TOKEN, url: CABINET }]);
    const page = await ctx.newPage();
    for (const [key, path, extra = {}] of CABINET_SHOTS) {
      if (only && !only.includes(key)) continue;
      if (extra.mobileOnly && tag !== 'm390') continue;
      await page.goto(`${CABINET}${path}`, { waitUntil: 'networkidle', timeout: 120_000 }).catch(() => {});
      await page.waitForTimeout(600);
      if (extra.click) {
        await page.locator(extra.click).first().click().catch(() => {});
        await page.waitForTimeout(300);
      }
      if (extra.fill) {
        await page.locator('#wd-address').fill('TRbrer2M9awcrEckpFG568rhsBVRpN4w8k').catch(() => {});
        await page.locator('#wd-amount').fill('250').catch(() => {});
        await page.locator('#wd-amount').blur().catch(() => {});
        await page.getByRole('button', { name: /Продолжить/ }).click().catch(() => {});
        await page.waitForTimeout(300);
      }
      const name = `${key}${suffix}-${tag}`;
      await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: tag !== 'm390' });
      if (tag === 'm390' && !extra.click) {
        // Во всю длину фиксированная нижняя панель «впечаталась» бы посреди
        // страницы — в -full её прячем (она видна на кадре вьюпорта).
        const style = await page.addStyleTag({ content: 'nav.fixed.bottom-0{display:none!important}' });
        await page.screenshot({ path: join(outDir, `${name}-full.png`), fullPage: true });
        await style.evaluate((el) => el.remove());
      }
      console.log('ok', name);
    }
    await ctx.close();
  }
}

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
try {
  if (set === 'admin' || set === 'all') await shootAdmin(browser);
  if (set === 'cabinet' || set === 'all') await shootCabinet(browser);
} finally {
  await browser.close();
}
