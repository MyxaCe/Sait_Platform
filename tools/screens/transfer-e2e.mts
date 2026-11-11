// E2E «Перевод клиента на другую платформу группы» на ДВУХ платформах (ветка client-transfer).
//
//   npx tsx tools/screens/transfer-e2e.mts <outDir>
//
// Стенд (см. отчёт ветки): Postgres с базами broker_apex / broker_nordex (все
// миграции; apex — seed:demo + менеджер Соколов закреплён за Морозовым, Смирнов
// с country=US; nordex — один admin), реестр группы в обеих базах
// (seed:group-registry), админки 3611/3621, кабинеты 3612/3622 (next start -H localhost: на 127.0.0.1 цикл редиректа next-intl), заглушки CMS
// 3631 и терминала 3632, воркер почты nordex → GreenMail (IMAP 55523).
//
// Сценарий: клиент apex пишет заявление в чат поддержки → менеджер проводит
// перевод (UI) → пакет уходит в nordex → письмо-приглашение (GreenMail) →
// регистрация по ссылке с предзаполнением → KYC → статусы вернулись в apex →
// закрытие счёта → admin возвращает перевод ПОСЛЕ регистрации; второй клиент —
// возврат ДО регистрации (ссылка отозвана). Негативы: без доказательства
// (кнопка неактивна), тикет оператора, запрещённое направление, неверная
// подпись, чужой ключ, повтор сообщения, повтор пакета.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import type { Envelope } from '../../packages/transfer/src/index.ts';

// Пакеты монорепо — CJS-исходники TS: берём через динамический импорт (tsx), без статических имён.
const unwrap = <T,>(m: T): T => ((m as { default?: T }).default ?? m);
const T = unwrap(await import('../../packages/transfer/src/index.ts')) as typeof import('../../packages/transfer/src/index.ts');
const SUP = unwrap(await import('../../packages/support/src/index.ts')) as typeof import('../../packages/support/src/index.ts');
const { createTransfer, signEnvelope, newNonce } = T;
const { postClientChatMessage, DEFAULT_SUPPORT_SETTINGS } = SUP;

const root = resolve(import.meta.dirname, '../..');
const reqWeb = createRequire(join(root, 'apps/web/package.json'));
const reqAdmin = createRequire(join(root, 'apps/admin/package.json'));
const reqMail = createRequire(join(root, 'apps/support-mail/package.json'));
const { chromium } = reqWeb('@playwright/test');
const { Pool } = reqAdmin('pg');
const { ImapFlow } = reqMail('imapflow');
const { simpleParser } = reqMail('mailparser');

const outDir = resolve(process.argv[2] ?? 'screens-transfer');
mkdirSync(outDir, { recursive: true });
const STAND = process.env.STAND_DIR!;
const PG = process.env.PG_URL ?? 'postgres://pg:pg@127.0.0.1:55520';
const A_ADMIN = 'http://127.0.0.1:3611';
const A_CAB = 'http://localhost:3612';
const N_ADMIN = 'http://127.0.0.1:3621';
const N_CAB = 'http://localhost:3622';
const TERMINAL = 'http://127.0.0.1:3632';
const SECRET = 'local-design-secret-not-for-prod-0123456789';
const HERO = '00000000-0000-4000-8000-0000000c0001';
const SOKOLOV = '00000000-0000-4000-8000-00000000a002';
const KOVALEVA = '00000000-0000-4000-8000-00000000a001';

const apex = new Pool({ connectionString: `${PG}/broker_apex`, max: 3 });
const nordex = new Pool({ connectionString: `${PG}/broker_nordex`, max: 3 });
const results: { step: string; ok: boolean; detail?: string }[] = [];
const check = (step: string, ok: boolean, detail?: string) => {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${step}${detail ? ` — ${detail}` : ''}`);
};
const q = async (db: typeof apex, sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows;
async function waitFor<T>(what: string, fn: () => Promise<T | null | undefined | false>, ms = 60_000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() - t0 > ms) throw new Error(`не дождались: ${what}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const { SignJWT } = await import('file://' + reqAdmin.resolve('jose').replace(/\\/g, '/'));
const token = (sub: string, login: string, name: string, role: string) =>
  new SignJWT({ login, name, role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('platform-admin')
    .setAudience('admin-center')
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('2h')
    .sign(new TextEncoder().encode(SECRET));

const browser = await chromium.launch();
async function adminPage(base: string, sub: string, login: string, name: string, role: string) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'ru-RU' });
  await ctx.addCookies([{ name: 'admin_operator_session', value: await token(sub, login, name, role), url: base }]);
  return ctx.newPage();
}
const shot = async (page: { screenshot(o: object): Promise<unknown>; evaluate(f: () => void): Promise<unknown> }, name: string, full = true) => {
  if (full) await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: full });
  console.log('     скрин', name);
};
const go = async (page: { goto(u: string, o: object): Promise<unknown>; waitForTimeout(n: number): Promise<void> }, url: string) => {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 120_000 });
  await page.waitForTimeout(400);
};

try {
  // ── 1. Клиент apex пишет заявление в чат поддержки кабинета ──
  const cab = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' })).newPage();
  await go(cab, `${A_CAB}/login`);
  await cab.fill('#email', 'a.morozov@northbay.capital');
  await cab.fill('#password', 'Client-pass-2026');
  await cab.getByRole('button', { name: 'Войти' }).click();
  await cab.waitForURL((u: URL) => !u.pathname.includes('login'), { timeout: 60_000 });
  await cab.waitForTimeout(800);
  await cab.getByRole('button', { name: /Открыть чат поддержки/ }).click();
  const text =
    'Здравствуйте! Я переезжаю на Кипр и прошу перевести мой счёт на платформу вашей группы Nordex Markets (у неё лицензия ЕС). ' +
    'Согласен, чтобы вы передали Nordex Markets мои ФИО, email, страну, язык и статус проверки личности для приглашения.';
  await cab.getByLabel('Напишите сообщение…').fill(text);
  await cab.getByRole('button', { name: 'Отправить' }).click();
  await cab.waitForTimeout(2500);
  await shot(cab, 't01-cabinet-apex-client-request-chat', false);
  const ticket = await waitFor('тикет клиента', async () =>
    (await q(apex, `SELECT t.id, t.number FROM support_tickets t JOIN support_messages m ON m.ticket_id = t.id
                     WHERE t.user_id = $1 AND m.author_kind = 'client' AND m.body_text LIKE 'Здравствуйте! Я переезжаю%' LIMIT 1`, [HERO]))[0],
  );
  check('клиент написал заявление в поддержку (тикет из чата кабинета)', true, `тикет #${ticket.number}`);

  // ── 2. Менеджер (Соколов) проводит перевод ──
  const mgr = await adminPage(A_ADMIN, SOKOLOV, 'd.sokolov', 'Дмитрий Соколов', 'operator');
  await go(mgr, `${A_ADMIN}/clients/${HERO}`);
  await shot(mgr, 't02-apex-client-card-transfer-button', false);
  await mgr.getByRole('link', { name: /Перевести на другую платформу группы/ }).click();
  await mgr.waitForLoadState('networkidle');
  await mgr.waitForTimeout(500);
  const submit = mgr.getByRole('button', { name: 'Провести перевод' });
  check('без платформы/тикета/согласия кнопка «Провести перевод» неактивна', await submit.isDisabled());
  const opRejected = await mgr.getByText(/открыт оператором/).count();
  check('тикет, открытый оператором, в форме отвергнут', opRejected > 0);
  await shot(mgr, 't03-apex-transfer-form-empty');
  await mgr.getByRole('radio', { name: /^Nordex Markets/ }).click();
  await mgr.getByText(`#${ticket.number} ·`).click();
  await mgr.getByText('Согласие клиента в выбранном сообщении соответствует этому тексту').click();
  await mgr.getByPlaceholder('Что просит клиент в заявлении').fill(
    `Заявление клиента в тикете #${ticket.number}: переезд на Кипр, просит перевод в Nordex Markets; согласие на передачу данных в том же сообщении.`,
  );
  check('с платформой, тикетом и согласием кнопка активна', !(await submit.isDisabled()));
  await shot(mgr, 't04-apex-transfer-form-filled');
  await submit.click();
  await mgr.waitForTimeout(300);
  await shot(mgr, 't05-apex-transfer-confirm');
  await mgr.getByRole('button', { name: 'Да, провести перевод' }).click();
  await mgr.waitForURL(/\/clients\/transfers\//, { timeout: 60_000 });
  const transferId = mgr.url().split('/clients/transfers/')[1]!.split('?')[0]!;
  const tr = (await q(apex, `SELECT number, status FROM platform_transfers WHERE id = $1`, [transferId]))[0];
  check('перевод проведён менеджером (без одобрения admin)', Boolean(tr), `${tr.number}, статус ${tr.status}`);

  // ── 3. Пакет доставлен в nordex, письмо ушло, статус invited вернулся ──
  const inbound = await waitFor('входящий в nordex', async () =>
    (await q(nordex, `SELECT * FROM platform_transfers_inbound WHERE transfer_id = $1`, [transferId]))[0],
  );
  check('nordex принял подписанный пакет и создал приглашение (не счёт)', inbound.status === 'received' || inbound.status === 'invited', `${inbound.full_name}, ${inbound.email}, ${inbound.country}`);
  const users = await q(nordex, `SELECT count(*)::int AS n FROM users WHERE lower(email) = 'a.morozov@northbay.capital'`);
  check('счёт в цели не создан до регистрации клиента', users[0].n === 0);
  await waitFor('apex: invited', async () => (await q(apex, `SELECT 1 FROM platform_transfers WHERE id = $1 AND status = 'invited'`, [transferId]))[0], 90_000);
  check('статус «приглашение отправлено» вернулся в apex', true);
  await go(mgr, `${A_ADMIN}/clients/transfers/${transferId}`);
  await shot(mgr, 't06-apex-transfer-detail-invited');

  // письмо-приглашение из GreenMail
  const imap = new ImapFlow({ host: '127.0.0.1', port: 55523, secure: false, auth: { user: 'a.morozov@northbay.capital', pass: 'x' }, logger: false });
  await imap.connect();
  const lock = await imap.getMailboxLock('INBOX');
  let raw: Buffer | null = null;
  for await (const m of imap.fetch('1:*', { source: true })) raw = m.source;
  lock.release();
  await imap.logout();
  const mail = await simpleParser(raw!);
  const link = /http:\/\/localhost:3622\/register\?invite=[A-Za-z0-9_-]+/.exec(mail.text ?? '')?.[0];
  check('письмо-приглашение от Nordex Markets получено (GreenMail)', Boolean(link), mail.subject);
  const mp = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await mp.setContent(
    `<html><body style="font-family:Segoe UI,Arial;max-width:760px;margin:32px auto;color:#111">
     <div style="color:#666;font-size:13px">От: ${mail.from?.text}<br>Кому: ${(mail.to as { text: string }).text}<br>Тема: <b>${mail.subject}</b><br>Дата: ${mail.date?.toISOString()}</div>
     <hr><pre style="white-space:pre-wrap;font-family:inherit;font-size:15px;line-height:1.5">${(mail.text ?? '').replace(/</g, '&lt;')}</pre></body></html>`,
  );
  await shot(mp, 't07-email-invite-greenmail');

  // ── 4. Регистрация по ссылке с предзаполнением ──
  const reg = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' })).newPage();
  await go(reg, link!);
  const prefilled = {
    first: await reg.inputValue('#firstName'),
    last: await reg.inputValue('#lastName'),
    email: await reg.inputValue('#email'),
    country: await reg.inputValue('#country'),
  };
  check('форма регистрации nordex предзаполнена согласованными полями', prefilled.email === 'a.morozov@northbay.capital' && prefilled.first === 'Алексей', JSON.stringify(prefilled));
  await shot(reg, 't08-nordex-register-prefilled');
  await reg.fill('#phone', '+357 25 123456');
  await reg.fill('#password', 'Nordex-pass-2026');
  await reg.getByRole('button', { name: 'Открыть счёт' }).click();
  await reg.waitForURL((u: URL) => !u.pathname.includes('register'), { timeout: 60_000 });
  const nUser = await waitFor('пользователь nordex', async () =>
    (await q(nordex, `SELECT id FROM users WHERE lower(email) = 'a.morozov@northbay.capital'`))[0],
  );
  check('клиент сам зарегистрировался в nordex', true, nUser.id);
  await waitFor('apex: registered', async () => (await q(apex, `SELECT 1 FROM platform_transfers WHERE id = $1 AND status = 'registered'`, [transferId]))[0], 60_000);
  check('статус «клиент зарегистрировался» вернулся в apex', true);
  // повторная ссылка — использована (новый браузер: у зарегистрировавшегося есть сессия)
  const again = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' })).newPage();
  await go(again, link!);
  check('ссылка приглашения одноразовая', (await again.getByText(/недействительна или уже использована/).count()) > 0);

  // KYC в цели (решение KYC nordex) → kyc_passed
  await nordex.query(`INSERT INTO client_verification (user_id, state) VALUES ($1, 'verified') ON CONFLICT (user_id) DO UPDATE SET state = 'verified', updated_at = now()`, [nUser.id]);
  await waitFor('apex: kyc_passed', async () => (await q(apex, `SELECT 1 FROM platform_transfers WHERE id = $1 AND status = 'kyc_passed'`, [transferId]))[0], 60_000);
  check('статус «KYC в цели пройден» вернулся в apex', true);

  // экраны: источник (admin, уведомление, деталь), цель (входящие), кабинет-источник
  const adm = await adminPage(A_ADMIN, KOVALEVA, 'i.kovaleva', 'Ирина Ковалёва', 'admin');
  await go(adm, `${A_ADMIN}/`);
  await shot(adm, 't09-apex-dashboard-admin-notification', false);
  await go(adm, `${A_ADMIN}/clients/transfers`);
  await shot(adm, 't10-apex-transfers-admin');
  await go(adm, `${A_ADMIN}/clients/transfers/${transferId}`);
  await shot(adm, 't11-apex-transfer-detail-kyc-passed-admin');
  const nadminId = (await q(nordex, `SELECT id FROM operators WHERE login = 'n.admin'`))[0].id;
  const nadm = await adminPage(N_ADMIN, nadminId, 'n.admin', 'Ханна Мюллер', 'admin');
  await go(nadm, `${N_ADMIN}/clients/transfers?tab=in`);
  await shot(nadm, 't12-nordex-transfers-inbound');
  await go(cab, `${A_CAB}/wallet?tab=withdraw`);
  await shot(cab, 't13-cabinet-apex-wallet-transfer-notice', false);

  // ── 5. Закрытие счёта в источнике (менеджер): только пустой счёт, fail-closed ──
  const setBalance = (minor: number, positions = 0) =>
    fetch(`${TERMINAL}/__stand/balance?minor=${minor}&positions=${positions}`, { method: 'POST' });
  const tryClose = async () => {
    await go(mgr, `${A_ADMIN}/clients/transfers/${transferId}`);
    await mgr.getByPlaceholder(/клиент подтвердил в тикете/).fill('Клиент в тикете подтвердил: средства выведены, работает в Nordex Markets.');
    await mgr.getByRole('button', { name: 'Закрыть счёт здесь' }).click();
    await mgr.getByRole('button', { name: 'Да, закрыть счёт' }).click();
    await mgr.waitForTimeout(2500);
  };
  const statusNow = async () => (await q(apex, `SELECT status FROM platform_transfers WHERE id = $1`, [transferId]))[0].status;
  // незавершённые заявки ввода/вывода (из сида) — отказ
  await setBalance(0);
  await tryClose();
  check('закрытие отказано: незавершённые вывод/пополнение на сайте', (await mgr.getByText(/незавершённых заявок на вывод/).count()) > 0 && (await statusNow()) === 'kyc_passed');
  await apex.query(`UPDATE crypto_withdrawals SET status = 'cancelled' WHERE user_id = $1 AND status NOT IN ('settled', 'rejected', 'cancelled')`, [HERO]);
  await apex.query(`UPDATE crypto_deposits SET status = 'rejected', reject_reason = 'стенд' WHERE user_id = $1 AND status = 'claimed'`, [HERO]);
  // на счёте деньги и позиции — отказ с суммой
  await setBalance(4_825_013, 1);
  await tryClose();
  check('закрытие отказано: на счёте 48 250,13 USDT и позиция', (await mgr.getByText(/Сначала клиент выводит средства \(48\s?250,13 USDT\) и закрывает позиции/).count()) > 0 && (await statusNow()) === 'kyc_passed');
  await shot(mgr, 't13b-apex-close-refused-funds', false);
  // терминал недоступен — отказ (fail-closed)
  await fetch(`${TERMINAL}/__stand/down?on=1`, { method: 'POST' });
  await tryClose();
  check('закрытие отказано: терминал недоступен → «не удалось проверить баланс»', (await mgr.getByText(/не удалось проверить баланс/).count()) > 0 && (await statusNow()) === 'kyc_passed');
  await fetch(`${TERMINAL}/__stand/down?on=0`, { method: 'POST' });
  // ноль — можно
  await setBalance(0);
  await tryClose();
  const closed = (await q(apex, `SELECT t.status, f.frozen FROM platform_transfers t LEFT JOIN client_money_flags f ON f.user_id = t.user_id WHERE t.id = $1`, [transferId]))[0];
  check('счёт в источнике закрыт по переводу (заморожен)', closed.status === 'source_closed' && closed.frozen === true);

  // ── 6. Возврат ПОСЛЕ регистрации (admin) — клиент уже пополнил цель ──
  await nordex.query(`INSERT INTO crypto_deposits (user_id, tx_hash, status, amount_minor, credited_at) VALUES ($1, $2, 'credited', 150000, now())`, [nUser.id, 'b'.repeat(64)]);
  await go(adm, `${A_ADMIN}/clients/transfers/${transferId}`);
  await adm.getByPlaceholder(/Что не так с переводом/).fill('Проверка: заявление клиента не подтверждено звонком на номер из анкеты — возврат по регламенту.');
  await adm.getByRole('button', { name: 'Вернуть перевод' }).click();
  await shot(adm, 't14-apex-revoke-confirm-after-registration', false);
  await adm.getByRole('button', { name: 'Да, вернуть перевод' }).click();
  await adm.waitForTimeout(1500);
  const nIn = await waitFor('nordex: revoked + заморозка', async () =>
    (await q(nordex, `SELECT i.status, i.freeze_state, i.refund_task, f.frozen, f.withdraw_banned FROM platform_transfers_inbound i
                       JOIN client_money_flags f ON f.user_id = i.registered_user_id WHERE i.transfer_id = $1 AND i.status = 'revoked'`, [transferId]))[0],
  );
  check('цель заморозила счёт клиента (торговля/вывод), задача «вернуть средства»', nIn.frozen && nIn.withdraw_banned && nIn.refund_task === 'open', JSON.stringify(nIn));
  const notice = await q(nordex, `SELECT subject FROM outbound_mail WHERE purpose = 'transfer_notice' AND to_address = 'a.morozov@northbay.capital'`);
  check('клиенту цели поставлено письмо о приостановке', notice.length === 1, notice[0]?.subject);
  await waitFor('apex: revoke_applied + разморозка', async () =>
    (await q(apex, `SELECT 1 FROM platform_transfers t JOIN client_money_flags f ON f.user_id = t.user_id
                     WHERE t.id = $1 AND t.revoke_applied_at IS NOT NULL AND f.frozen = false AND t.restore_state = 'done'`, [transferId]))[0],
  );
  check('источник: клиент восстановлен (заморозка закрытия снята), цель подтвердила возврат', true);
  await waitFor('nordex: заморозка в терминале', async () => (await q(nordex, `SELECT 1 FROM platform_transfers_inbound WHERE transfer_id = $1 AND freeze_state = 'applied'`, [transferId]))[0]);
  check('цель: торговля заморожена в терминале (повтор воркера)', true);
  await go(adm, `${A_ADMIN}/clients/transfers/${transferId}`);
  await shot(adm, 't15-apex-transfer-revoked-after-registration');
  await go(nadm, `${N_ADMIN}/clients/transfers?tab=in`);
  await shot(nadm, 't16-nordex-inbound-revoked-refund-task');
  await go(nadm, `${N_ADMIN}/clients/${nUser.id}`);
  await shot(nadm, 't17-nordex-client-card-frozen', false);

  // ── 7. Второй клиент: возврат ДО регистрации ──
  const fischer = (await q(apex, `SELECT id FROM users WHERE email = 'elena.fischer@fischer-holding.de'`))[0].id;
  await apex.query(`UPDATE users SET country = 'DE' WHERE id = $1`, [fischer]);
  const settings = { ...DEFAULT_SUPPORT_SETTINGS, hours: { ...DEFAULT_SUPPORT_SETTINGS.hours, alwaysOpen: true } };
  const t2 = await postClientChatMessage(apex, settings, {
    userId: fischer,
    body: 'Hello, please move my account to Nordex Markets (EU). I agree that you share my name, email, country, language and KYC status with Nordex Markets.',
  });
  if (!t2.ok) throw new Error('тикет Fischer');
  const msg2 = (await q(apex, `SELECT id FROM support_messages WHERE ticket_id = $1 ORDER BY created_at LIMIT 1`, [t2.ticketId]))[0].id;
  const r2 = await createTransfer(apex, {
    operatorId: SOKOLOV,
    userId: fischer,
    targetSlug: 'nordex-eu',
    ticketId: t2.ticketId,
    consentMessageId: msg2,
    consentConfirmed: true,
    basis: `Заявление клиента в тикете #${t2.number}`,
    selfSlug: 'apex-ru',
  });
  if (!r2.ok) throw new Error(`перевод Fischer: ${JSON.stringify(r2)}`);
  await waitFor('nordex: invite Fischer sent', async () => (await q(nordex, `SELECT 1 FROM platform_transfers_inbound WHERE transfer_id = $1 AND status = 'invited'`, [r2.transferId]))[0], 90_000);
  // ссылку берём из письма Fischer
  const imap2 = new ImapFlow({ host: '127.0.0.1', port: 55523, secure: false, auth: { user: 'elena.fischer@fischer-holding.de', pass: 'x' }, logger: false });
  await imap2.connect();
  const lock2 = await imap2.getMailboxLock('INBOX');
  let raw2: Buffer | null = null;
  for await (const m of imap2.fetch('1:*', { source: true })) raw2 = m.source;
  lock2.release();
  await imap2.logout();
  const link2 = /http:\/\/localhost:3622\/en\/register\?invite=[A-Za-z0-9_-]+|http:\/\/localhost:3622\/register\?invite=[A-Za-z0-9_-]+/.exec((await simpleParser(raw2!)).text ?? '')?.[0];
  await go(adm, `${A_ADMIN}/clients/transfers/${r2.transferId}`);
  await adm.getByPlaceholder(/Что не так с переводом/).fill('Менеджер оформил перевод без звонка-подтверждения — возврат до регистрации.');
  await adm.getByRole('button', { name: 'Вернуть перевод' }).click();
  await adm.getByRole('button', { name: 'Да, вернуть перевод' }).click();
  await waitFor('apex: revoke_applied (до регистрации)', async () =>
    (await q(apex, `SELECT 1 FROM platform_transfers WHERE id = $1 AND revoke_applied_at IS NOT NULL AND revoke_stage = 'before_registration'`, [r2.transferId]))[0],
  );
  const in2 = (await q(nordex, `SELECT status FROM platform_transfers_inbound WHERE transfer_id = $1`, [r2.transferId]))[0];
  check('возврат до регистрации: цель отозвала приглашение', in2.status === 'revoked');
  await go(again, link2!);
  check('ссылка отозванного приглашения недействительна', (await again.getByText(/отозвано|withdrawn/).count()) > 0);
  await shot(again, 't18-nordex-register-invite-revoked', false);
  await go(adm, `${A_ADMIN}/clients/transfers/${r2.transferId}`);
  await shot(adm, 't19-apex-transfer-revoked-before-registration');

  // ── 8. Негативы ──
  // запрещённое направление: Смирнов (US) — UI и сервер
  const smirnov = (await q(apex, `SELECT id FROM users WHERE email = 'igor.smirnov@example.net'`))[0].id;
  await go(mgr, `${A_ADMIN}/clients/${smirnov}/transfer`);
  check('UI: Nordex для клиента из US помечена «запрещено»', (await mgr.getByText('страна клиента запрещена в цели').count()) > 0);
  await shot(mgr, 't20-apex-transfer-form-forbidden-direction');
  const t3 = await postClientChatMessage(apex, settings, { userId: smirnov, body: 'Прошу перевести меня в Nordex Markets, согласен на передачу данных.' });
  if (!t3.ok) throw new Error();
  const m3 = (await q(apex, `SELECT id FROM support_messages WHERE ticket_id = $1 LIMIT 1`, [t3.ticketId]))[0].id;
  const r3 = await createTransfer(apex, { operatorId: SOKOLOV, userId: smirnov, targetSlug: 'nordex-eu', ticketId: t3.ticketId, consentMessageId: m3, consentConfirmed: true, basis: 'x', selfSlug: 'apex-ru' });
  check('сервер: запрещённое направление отвергнуто', !r3.ok && r3.reason === 'directionForbidden', JSON.stringify(r3));
  // тикет оператора (сервер)
  const opTicket = (await q(apex, `SELECT t.id FROM support_tickets t WHERE t.subject = 'Условия на Nordex'`))[0].id;
  const opMsg = (await q(apex, `SELECT id FROM support_messages WHERE ticket_id = $1 LIMIT 1`, [opTicket]))[0].id;
  const r4 = await createTransfer(apex, { operatorId: SOKOLOV, userId: HERO, targetSlug: 'nordex-eu', ticketId: opTicket, consentMessageId: opMsg, consentConfirmed: true, basis: 'x', selfSlug: 'apex-ru' });
  check('сервер: тикет, открытый оператором, отвергнут', !r4.ok && r4.reason === 'ticketOpenedByOperator', JSON.stringify(r4));
  // без доказательства (нет тикета)
  const r5 = await createTransfer(apex, { operatorId: SOKOLOV, userId: HERO, targetSlug: 'nordex-eu', ticketId: '00000000-0000-4000-8000-000000000999', consentMessageId: opMsg, consentConfirmed: true, basis: 'x', selfSlug: 'apex-ru' });
  check('сервер: без доказательства (несуществующий тикет) — отказ', !r5.ok && r5.reason === 'ticketNotFound');
  // admin не проводит перевод
  const r6 = await createTransfer(apex, { operatorId: KOVALEVA, userId: HERO, targetSlug: 'nordex-eu', ticketId: ticket.id, consentMessageId: opMsg, consentConfirmed: true, basis: 'x', selfSlug: 'apex-ru' });
  check('сервер: перевод проводит только закреплённый менеджер (admin — нет)', !r6.ok && r6.reason === 'notClientManager');

  // подпись: подмена тела, чужой ключ, повтор, устаревшее
  const apexKey = (await import('node:crypto')).createPrivateKey(Buffer.from(readFileSync(join(STAND, 'apex.key.b64'), 'utf8'), 'base64').toString('utf8'));
  const post = async (body: string) => {
    const r = await fetch(`${N_ADMIN}/api/platform-transfer/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    return { status: r.status, body: (await r.json()) as { code?: string; result?: string } };
  };
  const env = (kind: Envelope['kind'], data: object, transferId = '6f0c2b1e-0000-4000-8000-00000000e2e1'): Envelope => ({
    v: 1, kind, messageId: 'e2e', from: 'apex-ru', to: 'nordex-eu', transferId, issuedAt: new Date().toISOString(), nonce: newNonce(), data,
  });
  const good = signEnvelope(env('transfer.revoke', { number: 'TR-e2e', basis: 'e2e', revokedAt: new Date().toISOString() }), apexKey);
  const tampered = JSON.parse(JSON.stringify(good));
  tampered.envelope.data.basis = 'подмена';
  let r = await post(JSON.stringify(tampered));
  check('приёмник: подмена тела → 401 badSignature', r.status === 401 && r.body.code === 'badSignature');
  const foreign = generateKeyPairSync('ed25519').privateKey;
  r = await post(JSON.stringify(signEnvelope(env('transfer.revoke', { number: 'x', basis: 'x', revokedAt: '2026-11-11T00:00:00Z' }), foreign)));
  check('приёмник: подпись чужим ключом → 401 badSignature', r.status === 401 && r.body.code === 'badSignature');
  r = await post(JSON.stringify(good));
  const r2nd = await post(JSON.stringify(good));
  check('приёмник: повтор перехваченного сообщения → 409 replay', r.status === 200 && r2nd.status === 409 && r2nd.body.code === 'replay', `${r.status}/${r2nd.status}`);
  const stale = signEnvelope({ ...env('transfer.revoke', { number: 'x', basis: 'x', revokedAt: 'x' }), issuedAt: new Date(Date.now() - 3_600_000).toISOString() }, apexKey);
  r = await post(JSON.stringify(stale));
  check('приёмник: устаревшее (час назад) → 401 staleMessage', r.status === 401 && r.body.code === 'staleMessage');
  // повтор пакета перевода (новый nonce, тот же transferId) — дубликат без второго письма
  await apex.query(`UPDATE platform_transfer_outbox SET state = 'queued', next_attempt_at = now(), attempts = 0 WHERE transfer_id = $1 AND kind = 'transfer.package'`, [r2.transferId]);
  await waitFor('повтор пакета обработан', async () => (await q(apex, `SELECT 1 FROM platform_transfer_outbox WHERE transfer_id = $1 AND kind = 'transfer.package' AND state <> 'queued' AND state <> 'sending'`, [r2.transferId]))[0]);
  const pk = (await q(apex, `SELECT state, response_code FROM platform_transfer_outbox WHERE transfer_id = $1 AND kind = 'transfer.package'`, [r2.transferId]))[0];
  const invites = (await q(nordex, `SELECT count(*)::int AS n FROM outbound_mail WHERE purpose = 'transfer_invite' AND to_address = 'elena.fischer@fischer-holding.de'`))[0].n;
  check('повтор пакета: отвергнут как отозванный/дубликат, второго приглашения нет', invites === 1, `${pk.state} ${pk.response_code}`);

  // ── 9. Итоговые экраны ──
  await go(adm, `${A_ADMIN}/clients/transfers`);
  await shot(adm, 't21-apex-transfers-list-final');
  await go(adm, `${A_ADMIN}/clients/transfers?tab=report`);
  await shot(adm, 't22-apex-transfers-report-managers');
  await go(adm, `${A_ADMIN}/operators?id=${SOKOLOV}`);
  await shot(adm, 't23-apex-operators-revoked-counter');
  await go(adm, `${A_ADMIN}/settings#group`);
  await shot(adm, 't24-apex-settings-group-registry');
  await go(nadm, `${N_ADMIN}/settings#group`);
  await shot(nadm, 't25-nordex-settings-group-registry');
  await go(adm, `${A_ADMIN}/journal`);
  await shot(adm, 't26-apex-journal-transfers');
  await go(nadm, `${N_ADMIN}/journal`);
  await shot(nadm, 't27-nordex-journal-transfers');
} catch (e) {
  check('сценарий', false, (e as Error).stack ?? String(e));
} finally {
  writeFileSync(join(outDir, 'e2e-result.json'), JSON.stringify(results, null, 2));
  await browser.close();
  await apex.end();
  await nordex.end();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nИтог: ${results.length - failed}/${results.length} проверок`);
  process.exit(failed ? 1 : 0);
}
