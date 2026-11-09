// Скриншотер редизайна (dev-инструмент, НЕ продовый код).
//
// Снимает экраны админки (1440) и кабинета (390 + 1440) локального стенда.
// Админ-сессию выпускает сам: подписывает HS256 тем же ADMIN_SESSION_SECRET,
// что в apps/admin/.env.local (оператор с включённой 2FA засеян seed:demo).
// Кабинет — по сессии, засеянной seed:demo (cookie cabinet_session).
//
//   node tools/screens/shoot.mjs <outDir> [--set admin|cabinet|all] [--palette <name>] [--only key,key]
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
  ['14-login', '/login'],
];

const CABINET_SHOTS = [
  ['c01-home', '/ru'],
  ['c02-deposit', '/ru/deposit'],
  ['c03-withdraw', '/ru/withdraw'],
  ['c04-history', '/ru/history'],
];

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
    const ctx = await browser.newContext({
      viewport: { width: w, height: h },
      deviceScaleFactor: tag === 'm390' ? 2 : 1,
      isMobile: tag === 'm390',
      hasTouch: tag === 'm390',
      locale: 'ru-RU',
    });
    await ctx.addCookies([{ name: 'cabinet_session', value: 'demo-cabinet-token-0001', url: CABINET }]);
    const page = await ctx.newPage();
    for (const [key, path] of CABINET_SHOTS) {
      if (only && !only.includes(key)) continue;
      await page.goto(`${CABINET}${path}`, { waitUntil: 'networkidle', timeout: 120_000 }).catch(() => {});
      await page.waitForTimeout(600);
      await page.screenshot({ path: join(outDir, `${key}-${tag}.png`), fullPage: tag !== 'm390' });
      if (tag === 'm390') await page.screenshot({ path: join(outDir, `${key}-${tag}-full.png`), fullPage: true });
      console.log('ok', key, tag);
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
