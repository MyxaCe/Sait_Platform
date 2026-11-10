// Скрины «Менеджеры клиентов» (ветка admin-managers), 1440.
//   ADMIN_URL=http://127.0.0.1:3491 node tools/screens/managers-shots.mjs <outDir>
// Нужны: миграции + seed:demo (+ seed:support-demo) на ПУСТОЙ локальной базе.
// Сцена: admin делает Д. Соколова менеджером → массово закрепляет за ним
// клиентов из реестра → карточка с панелью «Менеджер» → Соколов видит
// «Мои клиенты» в реестре (по умолчанию) и на дашборде.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const reqWeb = createRequire(join(root, 'apps/web/package.json'));
const reqAdmin = createRequire(join(root, 'apps/admin/package.json'));
const { chromium } = reqWeb('@playwright/test');
const { SignJWT } = await import('file://' + reqAdmin.resolve('jose').replace(/\\/g, '/'));

const outDir = resolve(process.argv[2] ?? 'screens-managers');
mkdirSync(outDir, { recursive: true });
const ADMIN = process.env.ADMIN_URL ?? 'http://127.0.0.1:3491';
const SECRET = process.env.ADMIN_SESSION_SECRET ?? 'local-design-secret-not-for-prod-0123456789';
const HERO = '00000000-0000-4000-8000-0000000c0001';
const SOKOLOV = '00000000-0000-4000-8000-00000000a002';

const WHO = {
  admin: { sub: '00000000-0000-4000-8000-00000000a001', login: 'i.kovaleva', name: 'Ирина Ковалёва', role: 'admin' },
  operator: { sub: SOKOLOV, login: 'd.sokolov', name: 'Дмитрий Соколов', role: 'operator' },
  finance: { sub: '00000000-0000-4000-8000-00000000a003', login: 'm.orlova', name: 'Мария Орлова', role: 'finance_operator' },
};

const token = (w) =>
  new SignJWT({ login: WHO[w].login, name: WHO[w].name, role: WHO[w].role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('platform-admin')
    .setAudience('admin-center')
    .setSubject(WHO[w].sub)
    .setIssuedAt()
    .setExpirationTime('2h')
    .sign(new TextEncoder().encode(SECRET));

const browser = await chromium.launch();
async function ctxFor(w) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'ru-RU' });
  await ctx.addCookies([{ name: 'admin_operator_session', value: await token(w), url: ADMIN }]);
  return ctx;
}
async function go(page, path) {
  await page.goto(`${ADMIN}${path}`, { waitUntil: 'networkidle', timeout: 180_000 });
  await page.waitForTimeout(400);
}
const shot = async (page, name, full = true) => {
  await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: full });
  console.log('ok', name);
};

// ── admin: флаг «менеджер клиентов» Соколову и Орловой ──
const admin = await ctxFor('admin');
let p = await admin.newPage();
for (const [id, reason] of [
  [SOKOLOV, 'Закреплён за розничным портфелем RU (приказ по отделу продаж)'],
  ['00000000-0000-4000-8000-00000000a003', 'Ведёт VIP-клиентов по денежным вопросам'],
]) {
  await go(p, `/operators?op=${id}`);
  if (await p.getByRole('button', { name: 'Сделать менеджером клиентов' }).count()) {
    await p.locator('#mgr-flag-reason').fill(reason);
    if (id === SOKOLOV) await shot(p, 'm01-operators-flag-form');
    await p.getByRole('button', { name: 'Сделать менеджером клиентов' }).click();
    await p.waitForTimeout(1500);
  }
}
await go(p, `/operators?op=${SOKOLOV}`);
await shot(p, 'm02-operators-flag-set');

// ── admin: массовое назначение из реестра ──
await go(p, '/clients?mgr=none');
const boxes = p.locator('input[type="checkbox"][name="userIds"]');
const n = Math.min(6, await boxes.count());
for (let i = 0; i < n; i++) await boxes.nth(i).check();
await p.locator('#bulk-manager').selectOption(SOKOLOV);
await p.locator('#bulk-reason').fill('Распределение новых клиентов RU между менеджерами, ноябрь');
await shot(p, 'm03-registry-bulk-selected', false);
await p.getByRole('button', { name: /^Назначить/ }).click();
await p.waitForTimeout(2000);
await shot(p, 'm04-registry-bulk-done', false);
// Двое оставшихся «без менеджера» — Орловой.
await go(p, '/clients?mgr=none');
const rest = p.locator('input[type="checkbox"][name="userIds"]');
for (let i = 0; i < Math.min(2, await rest.count()); i++) await rest.nth(i).check();
await p.locator('#bulk-manager').selectOption('00000000-0000-4000-8000-00000000a003');
await p.locator('#bulk-reason').fill('VIP: денежные вопросы ведёт финансовый менеджер');
await p.getByRole('button', { name: /^Назначить/ }).click();
await p.waitForTimeout(2000);
await go(p, '/clients');
await shot(p, 'm05-registry-all-manager-column');

// ── admin: карточка — смена менеджера с основанием ──
await go(p, `/clients/${HERO}`);
await shot(p, 'm06-card-manager-panel-admin');
const opt = await p.locator('#managerId option').nth(1).getAttribute('value');
if (opt) {
  await p.locator('#managerId').selectOption(opt);
  await p.locator('#manager-reason').fill('Клиент попросил персонального менеджера (обращение в поддержку)');
  await p.getByRole('button', { name: 'Сохранить' }).click();
  await p.waitForTimeout(2000);
  await go(p, `/clients/${HERO}?tab=journal`);
  await shot(p, 'm07-card-journal-manager-assigned');
}
await go(p, '/journal');
await shot(p, 'm08-journal-managers', false);
await admin.close();

// ── менеджер (operator): реестр по умолчанию «Мои клиенты», дашборд, карточка без формы ──
const op = await ctxFor('operator');
p = await op.newPage();
await go(p, '/');
await shot(p, 'm09-dashboard-manager-my-clients');
await go(p, '/clients');
await shot(p, 'm10-registry-manager-default-mine');
await go(p, '/clients?mgr=all');
await shot(p, 'm11-registry-manager-all', false);
const mine = await p.goto(`${ADMIN}/clients`).then(() => p.locator('table a[href^="/clients/"]').first().getAttribute('href'));
if (mine) {
  await go(p, mine);
  await shot(p, 'm12-card-manager-view-no-form', false);
}
await op.close();
await browser.close();
