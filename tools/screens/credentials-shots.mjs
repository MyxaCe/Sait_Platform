// Скрины «Учётные данные клиента» (ветка admin-credentials, функция 3), 1440.
//   ADMIN_URL=http://127.0.0.1:3521 node tools/screens/credentials-shots.mjs <outDir>
// Нужны: миграции + seed:demo + seed:support-demo; Д. Соколов — менеджер
// А. Морозова (HERO) и E. Fischer, М. Орлова — менеджер О. Лебедевой; у HERO
// есть заявка на вывод «подана» и две сессии. Админка запущена с
// CABINET_PUBLIC_URL (ссылки в письмах).
// Сцена: менеджер меняет email → выдаёт временный пароль → исправляет адрес
// в заявке → снимает автозаморозку → история; чужой клиент — только чтение;
// admin: настройки, фильтр журнала, алерт на дашборде.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const reqWeb = createRequire(join(root, 'apps/web/package.json'));
const reqAdmin = createRequire(join(root, 'apps/admin/package.json'));
const { chromium } = reqWeb('@playwright/test');
const { SignJWT } = await import('file://' + reqAdmin.resolve('jose').replace(/\\/g, '/'));

const outDir = resolve(process.argv[2] ?? 'screens-credentials');
mkdirSync(outDir, { recursive: true });
const ADMIN = process.env.ADMIN_URL ?? 'http://127.0.0.1:3521';
const SECRET = process.env.ADMIN_SESSION_SECRET ?? 'local-design-secret-not-for-prod-0123456789';
const HERO = '00000000-0000-4000-8000-0000000c0001';
const FOREIGN = '2c25cb09-e62a-4767-8647-efba20c164ab';
const NEW_ADDRESS = 'TJBjEhDhgj8x4qFkXCTtAbX5XJFfNvsrJ3';

const WHO = {
  admin: { sub: '00000000-0000-4000-8000-00000000a001', login: 'i.kovaleva', name: 'Ирина Ковалёва', role: 'admin' },
  manager: { sub: '00000000-0000-4000-8000-00000000a002', login: 'd.sokolov', name: 'Дмитрий Соколов', role: 'operator' },
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
const shot = async (target, name, full = true) => {
  // Страница — во всю высоту (или первый экран); локатор — ровно элемент.
  const isPage = typeof target.goto === 'function';
  await target.screenshot({ path: join(outDir, `${name}.png`), ...(isPage ? { fullPage: full } : {}) });
  console.log('ok', name);
};
// Блок формы — `<section>` с заголовком `<h3>` прямо внутри (не панель целиком).
const section = (p, title) => p.locator(`section:has(> div > h3:text-is("${title}"))`);
async function verify(scope, labels) {
  for (const l of labels) await scope.getByText(l, { exact: false }).first().click();
  await scope.getByPlaceholder('№ обращения').first().fill('1004');
}

const CARD = `/clients/${HERO}?tab=credentials`;

// ── Менеджер клиента ──
const mgr = await ctxFor('manager');
let p = await mgr.newPage();
await go(p, CARD);
await shot(p, 'c01-tab-manager-overview');

// Email: заполнение → взвод со сводкой → готово
let s = section(p, 'Email');
await s.locator('input[name="newEmail"]').fill('a.morozov.new@gmail.com');
await verify(s, ['Видеозвонок', 'Документ клиента']);
await s.locator('textarea[name="reason"]').fill('Клиент потерял доступ к рабочей почте northbay.capital; личность подтверждена видеозвонком');
await s.getByRole('button', { name: 'Сменить email' }).click();
await s.scrollIntoViewIfNeeded();
await shot(s, 'c02-email-confirm-summary');
await s.getByRole('button', { name: 'Да, сменить email' }).click();
await p.waitForTimeout(2500);
await go(p, CARD);
await shot(p, 'c03-after-email-autohold');

// Временный пароль: взвод → показан один раз
s = section(p, 'Пароль');
const tmp = s.locator('form').nth(1);
await verify(tmp, ['Видеозвонок', 'Ответы о счёте']);
await tmp.locator('textarea[name="reason"]').fill('Клиент на звонке, вход не удаётся — выдаю временный пароль');
await tmp.getByRole('button', { name: 'Выдать временный пароль' }).click();
await shot(s, 'c04-temp-password-confirm');
await tmp.getByRole('button', { name: 'Да, выдать пароль' }).click();
await p.getByTestId('temp-password').waitFor({ timeout: 30_000 });
await shot(s, 'c05-temp-password-shown-once');

// Адрес в заявке на вывод
await go(p, CARD);
s = section(p, 'Адрес в заявке на вывод');
await s.locator('input[name="newAddress"]').fill(NEW_ADDRESS);
await verify(s, ['Видеозвонок', 'Документ клиента']);
await s.locator('textarea[name="reason"]').fill('Клиент ошибся адресом в заявке: прислал верный адрес из своего кошелька, сверен посимвольно на звонке');
await s.getByRole('button', { name: 'Исправить адрес' }).click();
await shot(s, 'c06-address-confirm-summary');
await s.getByRole('button', { name: 'Да, исправить адрес' }).click();
await p.waitForTimeout(2500);
await shot(s, 'c07-address-done');

// Снять автозаморозку
await go(p, CARD);
s = section(p, 'Заморозка вывода');
await s.locator('form').first().locator('textarea[name="reason"]').fill('Клиент подтвердил смену email и пароля на видеозвонке, вывод нужен сегодня');
await s.getByRole('button', { name: 'Снять заморозку вывода' }).click();
await shot(s, 'c08-hold-lift-confirm');
await s.getByRole('button', { name: 'Да, снять' }).click();
await p.waitForTimeout(2500);

// Заморозка по распоряжению — 72 ч
await go(p, CARD);
s = section(p, 'Заморозка вывода');
await s.locator('input[name="hours"]').fill('72');
await s.locator('textarea[name="reason"]').fill('Клиент сообщил о подозрительном письме — придерживаю вывод до выяснения');
await s.getByRole('button', { name: 'Заморозить вывод' }).click();
await shot(s, 'c09-hold-set-confirm');
await s.getByRole('button', { name: 'Да, заморозить' }).click();
await p.waitForTimeout(2500);
await go(p, CARD);
await shot(p, 'c10-tab-history-after');
await go(p, `/clients/${HERO}`);
await shot(p, 'c11-card-banner-hold', false);

// Чужой клиент — только просмотр
await go(p, `/clients/${FOREIGN}?tab=credentials`);
await shot(p, 'c12-foreign-client-readonly', false);
await mgr.close();

// ── admin: настройки, журнал, дашборд ──
const adm = await ctxFor('admin');
p = await adm.newPage();
await go(p, '/settings');
const cred = p.locator('#credentials');
await cred.locator('input[name="alertPerOperatorDay"]').fill('3');
await cred.locator('textarea[name="reason"]').fill('СБ: порог алерта для демо — 3 правки в сутки');
await cred.getByRole('button', { name: 'Сохранить настройки безопасности' }).click();
await p.waitForTimeout(2000);
await cred.scrollIntoViewIfNeeded();
await shot(cred, 'c13-settings-credentials');
await go(p, `/journal?action=${encodeURIComponent('client.credentials.*')}`);
await shot(p, 'c14-journal-filter-credentials', false);
await go(p, '/');
await shot(p, 'c15-dashboard-admin-alert', false);
await adm.close();
await browser.close();
