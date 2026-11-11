import bcrypt from 'bcryptjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveMoneyPolicy, tronHexToBase58, USDT_TRC20_CONTRACT } from '@broker/money';
import { createTestDb, seedOperator, seedUser, type TestDb } from '@broker/support/testing';
import { ALL_ROLES, canEditClientCredentials } from '@/components/shell/sections';
import {
  changeClientEmail,
  fixWithdrawalAddress,
  generateTempPassword,
  issueTemporaryPassword,
  liftWithdrawHold,
  readCredentialSettings,
  sendPasswordResetLink,
  setWithdrawHold,
  updateCredentialSettings,
} from './core';
import {
  checklistFromText,
  CREDENTIAL_ACTIONS,
  DEFAULT_CREDENTIAL_SETTINGS,
  evaluateChecklist,
  maskAddress,
  maskEmail,
} from './policy';
import { getCredentialsAlerts, getCredentialsView } from './queries';

/**
 * Правка учётных данных — на НАСТОЯЩЕМ Postgres (PGlite, все миграции):
 * проверяются права в базе, CHECK-и, уникальность email, очередь писем,
 * гашение сессий и денежная политика тем же SQL, что в проде.
 */

const link = (path: string, token: string, locale: string) => `https://cab.test/${locale}${path}?token=${token}`;
const fastHash = (p: string) => bcrypt.hash(p, 4);
const ADDR_A = tronHexToBase58('41' + '11'.repeat(20));
const ADDR_B = tronHexToBase58('41' + '22'.repeat(20));
const CHECKS = ['video_call', 'document_match'];

let db: TestDb;
let admin: string;
let manager: string;
let otherManager: string;
let plainOperator: string;
let support: string;
let client: string;
let foreignClient: string;

async function makeManager(id: string) {
  await db.query(`UPDATE operators SET is_client_manager = true WHERE id = $1`, [id]);
}
async function assign(userId: string, managerId: string) {
  await db.query(
    `INSERT INTO client_managers (user_id, manager_id, assigned_by, reason) VALUES ($1, $2, $3, 'тест')
     ON CONFLICT (user_id) DO UPDATE SET manager_id = EXCLUDED.manager_id`,
    [userId, managerId, admin],
  );
}
async function journalRows() {
  const r = await db.query(`SELECT action, operator_id, subject_id, payload FROM admin_action_journal WHERE action LIKE 'client.credentials.%' ORDER BY seq`);
  return r.rows.map((x) => ({ action: String(x.action), operatorId: String(x.operator_id), subjectId: String(x.subject_id), payload: x.payload as Record<string, unknown> }));
}
async function mails() {
  const r = await db.query(`SELECT purpose, to_address, subject, body_text FROM outbound_mail ORDER BY created_at, purpose DESC`);
  return r.rows.map((x) => ({ purpose: String(x.purpose), to: String(x.to_address), subject: String(x.subject), body: String(x.body_text ?? '') }));
}
async function addSession(userId: string) {
  await db.query(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (gen_random_uuid(), $1, md5(random()::text), now() + interval '1 day')`,
    [userId],
  );
}
async function addWithdrawal(userId: string, status: string, address = ADDR_A, hash: string | null = null): Promise<string> {
  const r = await db.query(
    `INSERT INTO crypto_withdrawals (user_id, to_address, amount_minor, status, payout_tx_hash) VALUES ($1, $2, 5000, $3, $4) RETURNING id`,
    [userId, address, status, hash],
  );
  return String(r.rows[0]!.id);
}

beforeEach(async () => {
  db = await createTestDb();
  admin = await seedOperator(db, 'admin', 'boss');
  manager = await seedOperator(db, 'operator', 'anna');
  otherManager = await seedOperator(db, 'finance_operator', 'boris');
  plainOperator = await seedOperator(db, 'operator', 'olga');
  support = await seedOperator(db, 'support_operator', 'sasha');
  await makeManager(manager);
  await makeManager(otherManager);
  client = await seedUser(db, { email: 'Ivan.Petrov@Mail.test', name: 'Иван Петров' });
  foreignClient = await seedUser(db, { email: 'olga@client.test', name: 'Ольга Сидорова' });
  await assign(client, manager);
  await assign(foreignClient, otherManager);
  await db.query(`UPDATE users SET email_verified_at = now() WHERE id = $1`, [client]);
  // KYC пройден — иначе вывод закрыт и по KYC-гейту, и тест не отличит причину.
  await db.query(`INSERT INTO client_verification (user_id, state) VALUES ($1, 'verified')`, [client]);
});
afterEach(async () => db.close());

const editBase = (actorId: string, userId = client) => ({ actorId, userId, basis: 'Клиент потерял доступ к почте, звонок', ticket: '#1042', checks: CHECKS });

/* ─── Политика (чистые функции) ──────────────────────────────────────── */

describe('учётные данные · правила', () => {
  it('матрица: admin — любой клиент; менеджер — только закреплённый; остальные — нет', () => {
    for (const role of ALL_ROLES) {
      expect(canEditClientCredentials(role, { isAssignedManager: false })).toBe(role === 'admin');
    }
    expect(ALL_ROLES.filter((r) => canEditClientCredentials(r, { isAssignedManager: true }))).toEqual(['admin', 'operator', 'finance_operator']);
    expect(canEditClientCredentials(null, { isAssignedManager: true })).toBe(false);
  });

  it('маскирование email и адреса', () => {
    expect(maskEmail('anna.k@gmail.com')).toBe('a***@g***.com');
    expect(maskEmail('x@sub.domain.co.uk')).toBe('x***@s***.uk');
    expect(maskEmail('мусор')).toBe('***');
    expect(maskAddress('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')).toBe('TR7NH…Lj6t');
  });

  it('чек-лист: обязательные пункты и минимум отметок', () => {
    const s = { ...DEFAULT_CREDENTIAL_SETTINGS, checklist: [...DEFAULT_CREDENTIAL_SETTINGS.checklist], minChecked: 2 };
    expect(evaluateChecklist(s, ['video_call'])).toEqual({ ok: false, reason: 'checklistRequired' });
    expect(evaluateChecklist(s, ['video_call', 'known_channel']).ok).toBe(true);
    s.checklist[1] = { ...s.checklist[1]!, required: true };
    expect(evaluateChecklist(s, ['video_call', 'known_channel'])).toEqual({ ok: false, reason: 'checklistIncomplete' });
    const v = evaluateChecklist(s, ['document_match', 'video_call', 'bogus']);
    expect(v.ok && v.marks.filter((m) => m.checked).map((m) => m.id)).toEqual(['video_call', 'document_match']);
  });

  it('чек-лист из текста: «*» — обязательный, id прежних формулировок сохраняются', () => {
    const prev = DEFAULT_CREDENTIAL_SETTINGS.checklist;
    const items = checklistFromText(`* ${prev[0]!.label}\nНовый пункт\n\n${prev[2]!.label}`, prev);
    expect(items).toEqual([
      { id: 'video_call', label: prev[0]!.label, required: true },
      { id: 'item_1', label: 'Новый пункт', required: false },
      { id: 'account_questions', label: prev[2]!.label, required: false },
    ]);
  });

  it('временный пароль: 12 символов, без похожих, буквы обоих регистров и цифры', () => {
    for (let i = 0; i < 50; i++) {
      const p = generateTempPassword();
      expect(p).toMatch(/^[a-km-np-zA-HJ-NP-Z2-9]{12}$/);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[2-9]/);
    }
  });
});

/* ─── Права ──────────────────────────────────────────────────────────── */

describe('учётные данные · права (в базе, под транзакцией)', () => {
  it('менеджер — своего клиента можно, чужого нельзя; admin — любого', async () => {
    expect((await sendPasswordResetLink(editBase(manager), { pool: db, link })).ok).toBe(true);
    expect(await sendPasswordResetLink(editBase(manager, foreignClient), { pool: db, link })).toEqual({ ok: false, reason: 'forbidden' });
    expect((await sendPasswordResetLink(editBase(admin, foreignClient), { pool: db, link })).ok).toBe(true);
    // finance_operator-менеджер — своего клиента (решение владельца 10.11: финансист может быть менеджером).
    expect((await sendPasswordResetLink(editBase(otherManager, foreignClient), { pool: db, link })).ok).toBe(true);
  });

  it('оператор без флага, поддержка, отключённый менеджер и менеджер со снятым флагом — отказ, ничего не пишется', async () => {
    await assign(client, manager);
    const before = (await journalRows()).length;
    expect(await setWithdrawHold({ actorId: plainOperator, userId: client, basis: 'x', until: null }, { pool: db })).toEqual({ ok: false, reason: 'forbidden' });
    expect(await setWithdrawHold({ actorId: support, userId: client, basis: 'x', until: null }, { pool: db })).toEqual({ ok: false, reason: 'forbidden' });
    // Флаг снят, а строка закрепления осталась — не менеджер.
    await db.query(`UPDATE operators SET is_client_manager = false WHERE id = $1`, [manager]);
    expect(await changeClientEmail({ ...editBase(manager), newEmail: 'new@mail.test' }, { pool: db, link })).toEqual({ ok: false, reason: 'forbidden' });
    await db.query(`UPDATE operators SET is_client_manager = true, disabled_at = now() WHERE id = $1`, [manager]);
    expect(await issueTemporaryPassword(editBase(manager), { pool: db, hash: fastHash })).toEqual({ ok: false, reason: 'forbidden' });
    // Мусорный id автора — отказ без запроса к базе.
    expect(await liftWithdrawHold({ actorId: 'x', userId: client, basis: 'x' }, { pool: db })).toEqual({ ok: false, reason: 'forbidden' });
    expect((await journalRows()).length).toBe(before);
    expect(await mails()).toEqual([]);
  });

  it('вид вкладки: canEdit — у admin и своего менеджера; чужой менеджер и оператор без флага — только чтение', async () => {
    expect((await getCredentialsView(db, { userId: client, operatorId: admin, role: 'admin' })).editorAs).toBe('admin');
    expect((await getCredentialsView(db, { userId: client, operatorId: manager, role: 'operator' })).editorAs).toBe('manager');
    expect((await getCredentialsView(db, { userId: client, operatorId: otherManager, role: 'finance_operator' })).canEdit).toBe(false);
    expect((await getCredentialsView(db, { userId: client, operatorId: plainOperator, role: 'operator' })).canEdit).toBe(false);
  });

  it('основание и чек-лист обязательны; тикет — нет', async () => {
    expect(await sendPasswordResetLink({ ...editBase(manager), basis: '  ' }, { pool: db, link })).toEqual({ ok: false, reason: 'missingReason' });
    expect(await sendPasswordResetLink({ ...editBase(manager), checks: [] }, { pool: db, link })).toEqual({ ok: false, reason: 'checklistRequired' });
    expect((await sendPasswordResetLink({ ...editBase(manager), ticket: null }, { pool: db, link })).ok).toBe(true);
    const j = await journalRows();
    expect(j.at(-1)!.payload.ticket).toBeNull();
  });
});

/* ─── Email ──────────────────────────────────────────────────────────── */

describe('учётные данные · смена email', () => {
  it('сразу меняет email, новый — неподтверждённый; письмо подтверждения на новый и уведомление на старый', async () => {
    const r = await changeClientEmail({ ...editBase(manager), newEmail: '  New.Box@Gmail.com ' }, { pool: db, link });
    expect(r.ok).toBe(true);
    const u = await db.query(`SELECT email, email_verified_at FROM users WHERE id = $1`, [client]);
    expect(u.rows[0]).toMatchObject({ email: 'new.box@gmail.com', email_verified_at: null });

    const m = await mails();
    expect(m.map((x) => [x.purpose, x.to])).toEqual([
      ['email_verify', 'new.box@gmail.com'],
      ['credentials_notice', 'Ivan.Petrov@Mail.test'],
    ]);
    expect(m[0]!.body).toContain('https://cab.test/ru/verify-email?token=');
    expect(m[1]!.body).toContain('n***@g***.com');
    expect(m[1]!.body).toContain('№1042');
    expect(m[1]!.body).toContain('свяжитесь с поддержкой');

    const j = (await journalRows()).find((x) => x.action === CREDENTIAL_ACTIONS.emailChanged)!;
    expect(j.operatorId).toBe(manager);
    expect(j.payload).toMatchObject({
      basis: 'Клиент потерял доступ к почте, звонок',
      ticket: '1042',
      actorAs: 'manager',
      before: 'I***@M***.test',
      after: 'n***@g***.com',
      previousVerified: true,
      verificationSentToNew: true,
      noticeSentToOld: true,
    });
    expect((j.payload.checklist as { id: string; checked: boolean }[]).filter((c) => c.checked).map((c) => c.id)).toEqual(CHECKS);
  });

  it('подтверждение по ссылке из письма делает новый email подтверждённым (существующий механизм)', async () => {
    await changeClientEmail({ ...editBase(manager), newEmail: 'new@mail.test' }, { pool: db, link });
    const token = /token=([A-Za-z0-9_-]+)/.exec((await mails())[0]!.body)![1]!;
    const { confirmEmail } = await import('@broker/support');
    expect((await confirmEmail(db, { token })).ok).toBe(true);
    const u = await db.query(`SELECT email_verified_at FROM users WHERE id = $1`, [client]);
    expect(u.rows[0]!.email_verified_at).not.toBeNull();
  });

  it('уникальность email без учёта регистра; тот же email; мусор; без адреса кабинета — отказ', async () => {
    expect(await changeClientEmail({ ...editBase(manager), newEmail: 'OLGA@client.test' }, { pool: db, link })).toEqual({ ok: false, reason: 'emailTaken' });
    expect(await changeClientEmail({ ...editBase(manager), newEmail: 'ivan.petrov@mail.test' }, { pool: db, link })).toEqual({ ok: false, reason: 'sameEmail' });
    expect(await changeClientEmail({ ...editBase(manager), newEmail: 'not-an-email' }, { pool: db, link })).toEqual({ ok: false, reason: 'invalidEmail' });
    expect(await changeClientEmail({ ...editBase(manager), newEmail: 'new@mail.test' }, { pool: db, link: null })).toEqual({ ok: false, reason: 'linkUnavailable' });
    expect(await mails()).toEqual([]);
    expect((await db.query(`SELECT email FROM users WHERE id = $1`, [client])).rows[0]!.email).toBe('Ivan.Petrov@Mail.test');
  });

  it('ссылки, ушедшие на прежний адрес, гасятся', async () => {
    await sendPasswordResetLink(editBase(manager), { pool: db, link });
    await changeClientEmail({ ...editBase(manager), newEmail: 'new@mail.test' }, { pool: db, link });
    const live = await db.query(
      `SELECT purpose, email FROM auth_mail_tokens WHERE user_id = $1 AND used_at IS NULL AND token_hash IS NOT NULL`,
      [client],
    );
    expect(live.rows).toEqual([{ purpose: 'email_verify', email: 'new@mail.test' }]);
  });
});

/* ─── Пароль ─────────────────────────────────────────────────────────── */

describe('учётные данные · пароль', () => {
  it('ссылка сброса — существующий механизм auth_mail_tokens, на текущий email; лимит частоты', async () => {
    const r = await sendPasswordResetLink(editBase(manager), { pool: db, link });
    expect(r).toEqual({ ok: true, sentTo: 'i***@m***.test' });
    const m = await mails();
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ purpose: 'password_reset', to: 'ivan.petrov@mail.test' });
    expect(m[0]!.body).toContain('https://cab.test/ru/reset-password?token=');
    const t = await db.query(`SELECT purpose, token_hash FROM auth_mail_tokens WHERE user_id = $1`, [client]);
    expect(t.rows).toHaveLength(1);
    // Ещё две — в лимите (3 в час), четвёртая — отказ.
    await sendPasswordResetLink(editBase(manager), { pool: db, link });
    await sendPasswordResetLink(editBase(manager), { pool: db, link });
    expect(await sendPasswordResetLink(editBase(manager), { pool: db, link })).toEqual({ ok: false, reason: 'rateLimited' });
  });

  it('временный пароль: bcrypt-хеш, обязательная смена, срок, все сессии погашены, пароль только в ответе', async () => {
    await addSession(client);
    await addSession(client);
    const r = await issueTemporaryPassword(editBase(manager), { pool: db, hash: fastHash, generate: () => 'Tmp7PassWord' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.password).toBe('Tmp7PassWord');
    expect(r.sessionsRevoked).toBe(2);
    const u = await db.query(`SELECT password_hash, password_must_change, temp_password_expires_at FROM users WHERE id = $1`, [client]);
    const row = u.rows[0]!;
    expect(row.password_must_change).toBe(true);
    expect(await bcrypt.compare('Tmp7PassWord', String(row.password_hash))).toBe(true);
    const ttl = new Date(row.temp_password_expires_at as string).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(23 * 3_600_000);
    expect(ttl).toBeLessThanOrEqual(24 * 3_600_000);
    expect((await db.query(`SELECT count(*)::int AS n FROM sessions WHERE user_id = $1`, [client])).rows[0]!.n).toBe(0);

    const m = await mails();
    expect(m.map((x) => x.purpose)).toEqual(['credentials_notice']);
    expect(m[0]!.body).not.toContain('Tmp7PassWord');
    const all = JSON.stringify(await db.query(`SELECT payload FROM admin_action_journal`).then((x) => x.rows));
    expect(all).not.toContain('Tmp7PassWord');
    const j = (await journalRows()).find((x) => x.action === CREDENTIAL_ACTIONS.tempPasswordIssued)!;
    expect(j.payload).toMatchObject({ mustChange: true, sessionsRevoked: 2 });
  });
});

/* ─── Заморозка вывода ───────────────────────────────────────────────── */

describe('учётные данные · заморозка вывода (флаг «Запрет вывода» + resolveMoneyPolicy)', () => {
  it('менеджер замораживает со сроком и снимает вручную; политика денег это видит', async () => {
    const until = new Date(Date.now() + 48 * 3_600_000);
    expect(await setWithdrawHold({ actorId: manager, userId: client, basis: 'Подозрительный звонок', until }, { pool: db })).toEqual({ ok: true, until: until.toISOString() });
    let p = await resolveMoneyPolicy(client, db);
    expect(p.withdrawAllowed).toBe(false);
    expect(p.withdrawReasons).toEqual(['withdraw_banned']);
    expect(p.withdrawBanKind).toBe('credentials_manual');
    expect(p.withdrawBanUntil).toBe(until.toISOString());
    expect(p.depositAllowed).toBe(true);

    expect(await liftWithdrawHold({ actorId: manager, userId: client, basis: 'Клиент подтвердил личность' }, { pool: db })).toEqual({ ok: true });
    p = await resolveMoneyPolicy(client, db);
    expect(p.withdrawBanned).toBe(false);
    expect(await liftWithdrawHold({ actorId: manager, userId: client, basis: 'ещё раз' }, { pool: db })).toEqual({ ok: false, reason: 'noHold' });
    expect((await journalRows()).map((j) => j.action)).toEqual([CREDENTIAL_ACTIONS.holdSet, CREDENTIAL_ACTIONS.holdLifted]);
  });

  it('бессрочно; истёкший срок перестаёт действовать сам; срок в прошлом — отказ', async () => {
    await setWithdrawHold({ actorId: manager, userId: client, basis: 'до выяснения', until: null }, { pool: db });
    expect((await resolveMoneyPolicy(client, db)).withdrawBanUntil).toBeNull();
    expect((await resolveMoneyPolicy(client, db)).withdrawBanned).toBe(true);
    await db.query(`UPDATE client_money_flags SET withdraw_ban_until = now() - interval '1 minute' WHERE user_id = $1`, [client]);
    expect((await resolveMoneyPolicy(client, db)).withdrawAllowed).toBe(true);
    expect(await setWithdrawHold({ actorId: manager, userId: client, basis: 'x', until: new Date(Date.now() - 1000) }, { pool: db })).toEqual({ ok: false, reason: 'invalidUntil' });
  });

  it('запрет из денежных флагов менеджер не перекрывает и не снимает', async () => {
    await db.query(`INSERT INTO client_money_flags (user_id, withdraw_banned, withdraw_ban_kind) VALUES ($1, true, 'money_flags')`, [client]);
    expect(await setWithdrawHold({ actorId: manager, userId: client, basis: 'x', until: null }, { pool: db })).toEqual({ ok: false, reason: 'bannedByFinance' });
    expect(await liftWithdrawHold({ actorId: admin, userId: client, basis: 'x' }, { pool: db })).toEqual({ ok: false, reason: 'notCredentialsHold' });
    // Старая строка без kind (до миграции) — тоже «денежные флаги».
    await db.query(`UPDATE client_money_flags SET withdraw_ban_kind = NULL WHERE user_id = $1`, [client]);
    expect(await liftWithdrawHold({ actorId: manager, userId: client, basis: 'x' }, { pool: db })).toEqual({ ok: false, reason: 'notCredentialsHold' });
  });

  it('автозаморозка после смены email — по настройке; менеджер снимает её вручную', async () => {
    const r = await changeClientEmail({ ...editBase(manager), newEmail: 'new@mail.test' }, { pool: db, link });
    expect(r.ok && r.autoHoldUntil).toBeTruthy();
    const p = await resolveMoneyPolicy(client, db);
    expect(p.withdrawAllowed).toBe(false);
    expect(p.withdrawBanKind).toBe('credentials_auto');
    const hours = (new Date(p.withdrawBanUntil!).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThanOrEqual(24);
    expect((await journalRows()).map((j) => j.action)).toEqual([CREDENTIAL_ACTIONS.holdAutoSet, CREDENTIAL_ACTIONS.emailChanged]);

    expect(await liftWithdrawHold({ actorId: manager, userId: client, basis: 'Клиент на видеосвязи подтвердил смену' }, { pool: db })).toEqual({ ok: true });
    expect((await resolveMoneyPolicy(client, db)).withdrawAllowed).toBe(true);
  });

  it('автозаморозка выключена — после временного пароля вывод открыт', async () => {
    await db.query(`UPDATE platform_credential_settings SET auto_hold_enabled = false`);
    const r = await issueTemporaryPassword(editBase(manager), { pool: db, hash: fastHash });
    expect(r.ok && r.autoHoldUntil).toBeNull();
    expect((await resolveMoneyPolicy(client, db)).withdrawAllowed).toBe(true);
  });

  it('автозаморозка не сокращает бессрочную заморозку менеджера', async () => {
    await setWithdrawHold({ actorId: manager, userId: client, basis: 'до выяснения', until: null }, { pool: db });
    await issueTemporaryPassword(editBase(manager), { pool: db, hash: fastHash });
    const p = await resolveMoneyPolicy(client, db);
    expect(p.withdrawBanUntil).toBeNull();
    expect(p.withdrawBanKind).toBe('credentials_manual');
    const j = (await journalRows()).find((x) => x.action === CREDENTIAL_ACTIONS.tempPasswordIssued)!;
    expect(j.payload.autoHold).toEqual({ until: 'indefinite', applied: false });
  });
});

/* ─── Адрес в заявке на вывод ────────────────────────────────────────── */

describe('учётные данные · адрес в заявке на вывод', () => {
  it('requested и approved без хэша — правится; журнал до/после маскированно', async () => {
    const w1 = await addWithdrawal(client, 'requested');
    const w2 = await addWithdrawal(client, 'approved');
    expect(await fixWithdrawalAddress({ ...editBase(manager), withdrawalId: w1, newAddress: ` ${ADDR_B} ` }, { pool: db })).toEqual({
      ok: true,
      before: maskAddress(ADDR_A),
      after: maskAddress(ADDR_B),
    });
    expect((await fixWithdrawalAddress({ ...editBase(admin), withdrawalId: w2, newAddress: ADDR_B }, { pool: db })).ok).toBe(true);
    const rows = await db.query(`SELECT to_address, status, last_journal_seq FROM crypto_withdrawals WHERE user_id = $1`, [client]);
    for (const r of rows.rows) {
      expect(r.to_address).toBe(ADDR_B);
      expect(r.last_journal_seq).not.toBeNull();
    }
    const j = (await journalRows()).filter((x) => x.action === CREDENTIAL_ACTIONS.withdrawalAddressChanged);
    expect(j[0]!.payload).toMatchObject({ withdrawalId: w1, withdrawalStatus: 'requested', before: maskAddress(ADDR_A), after: maskAddress(ADDR_B), amountMinor: 5000 });
  });

  it('отправленная/исполненная/отклонённая заявка, чужая заявка — отказ', async () => {
    const hash = 'a'.repeat(64);
    const sent = await addWithdrawal(client, 'sent', ADDR_A, hash);
    const settled = await addWithdrawal(client, 'settled', ADDR_A, 'b'.repeat(64));
    const rejected = await addWithdrawal(client, 'rejected');
    const foreign = await addWithdrawal(foreignClient, 'requested');
    for (const id of [sent, settled, rejected]) {
      expect(await fixWithdrawalAddress({ ...editBase(manager), withdrawalId: id, newAddress: ADDR_B }, { pool: db })).toEqual({ ok: false, reason: 'withdrawalNotEditable' });
    }
    // Чужая заявка через своего клиента — «не найдена»; через чужого клиента — нет прав.
    expect(await fixWithdrawalAddress({ ...editBase(manager), withdrawalId: foreign, newAddress: ADDR_B }, { pool: db })).toEqual({ ok: false, reason: 'noWithdrawal' });
    expect(await fixWithdrawalAddress({ ...editBase(manager, foreignClient), withdrawalId: foreign, newAddress: ADDR_B }, { pool: db })).toEqual({ ok: false, reason: 'forbidden' });
    expect((await journalRows()).length).toBe(0);
  });

  it('только валидный адрес TRON и не контракт USDT; тот же адрес — отказ', async () => {
    const w = await addWithdrawal(client, 'requested');
    const bad = ADDR_B.slice(0, -1) + (ADDR_B.endsWith('a') ? 'b' : 'a');
    expect(await fixWithdrawalAddress({ ...editBase(manager), withdrawalId: w, newAddress: bad }, { pool: db })).toEqual({ ok: false, reason: 'invalidAddress' });
    expect(await fixWithdrawalAddress({ ...editBase(manager), withdrawalId: w, newAddress: '0x' + '1'.repeat(40) }, { pool: db })).toEqual({ ok: false, reason: 'invalidAddress' });
    expect(await fixWithdrawalAddress({ ...editBase(manager), withdrawalId: w, newAddress: USDT_TRC20_CONTRACT }, { pool: db })).toEqual({ ok: false, reason: 'contractAddress' });
    expect(await fixWithdrawalAddress({ ...editBase(manager), withdrawalId: w, newAddress: ADDR_A }, { pool: db })).toEqual({ ok: false, reason: 'sameAddress' });
  });
});

/* ─── Журнал и сигналы ───────────────────────────────────────────────── */

describe('учётные данные · журнал и алерты', () => {
  it('в журнале нет полного email, полного адреса и пароля — только маски', async () => {
    const w = await addWithdrawal(client, 'requested');
    await changeClientEmail({ ...editBase(manager), newEmail: 'secret.person@private.test' }, { pool: db, link });
    await issueTemporaryPassword(editBase(manager), { pool: db, hash: fastHash, generate: () => 'Zx9Zx9Zx9Zx9' });
    await fixWithdrawalAddress({ ...editBase(manager), withdrawalId: w, newAddress: ADDR_B }, { pool: db });
    const all = JSON.stringify((await db.query(`SELECT payload FROM admin_action_journal`)).rows).toLowerCase();
    for (const secret of ['secret.person@private.test', 'ivan.petrov@mail.test', ADDR_A, ADDR_B, 'zx9zx9zx9zx9']) {
      expect(all).not.toContain(secret.toLowerCase());
    }
    expect(all).toContain('s***@p***.test');
    expect(all).toContain(maskAddress(ADDR_B).toLowerCase());
  });

  it('счётчик необычной активности: больше N рискованных правок одним оператором за сутки; заморозки не считаются', async () => {
    await db.query(`UPDATE platform_credential_settings SET alert_per_operator_day = 2`);
    await sendPasswordResetLink(editBase(manager), { pool: db, link });
    await sendPasswordResetLink(editBase(manager), { pool: db, link });
    await setWithdrawHold({ actorId: manager, userId: client, basis: 'x', until: null }, { pool: db });
    let a = await getCredentialsAlerts(db);
    expect(a).toMatchObject({ total24h: 3, risky24h: 2, threshold: 2, unusual: [] });
    await issueTemporaryPassword(editBase(manager), { pool: db, hash: fastHash });
    a = await getCredentialsAlerts(db);
    expect(a.unusual).toEqual([{ operatorId: manager, operatorName: 'Оператор anna', count: 3 }]);
  });

  it('настройки: только с основанием, валидные значения, журнал до/после', async () => {
    const cur = await readCredentialSettings(db);
    expect(cur).toEqual(DEFAULT_CREDENTIAL_SETTINGS);
    const next = { ...cur, autoHoldEnabled: false, autoHoldHours: 48, alertPerOperatorDay: 3 };
    expect(await updateCredentialSettings({ actorId: admin, basis: '', next }, { pool: db })).toEqual({ ok: false, reason: 'missingReason' });
    expect(await updateCredentialSettings({ actorId: admin, basis: 'x', next: { ...next, autoHoldHours: 0 } }, { pool: db })).toEqual({ ok: false, reason: 'invalidSettings' });
    expect(await updateCredentialSettings({ actorId: admin, basis: 'x', next: { ...next, checklist: [] } }, { pool: db })).toEqual({ ok: false, reason: 'invalidSettings' });
    expect(await updateCredentialSettings({ actorId: admin, basis: 'Решение СБ', next }, { pool: db })).toEqual({ ok: true });
    expect(await readCredentialSettings(db)).toEqual(next);
    expect(await updateCredentialSettings({ actorId: admin, basis: 'x', next }, { pool: db })).toEqual({ ok: false, reason: 'noChange' });
    const j = await db.query(`SELECT action, subject_id, payload FROM admin_action_journal WHERE action = 'platform.credential_settings.updated'`);
    expect(j.rows[0]).toMatchObject({ subject_id: 'platform:credential_settings' });
  });
});
