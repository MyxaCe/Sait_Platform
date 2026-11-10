import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadClientContext, MONEY_COLUMNS_FORBIDDEN_FOR_SUPPORT } from './context';
import { DEFAULT_SUPPORT_SETTINGS } from './settings';
import { assignTicket, operatorReply, postClientChatMessage, type Actor } from './tickets';
import { getTicketForOperator, listQueue, queueStats } from './queries';
import { saveSupportSettings, saveTemplate, findAttachmentForOperator } from './admin';
import { allowedTransitions, asSupportRole, canTransition, supportAccess } from './model';
import { createTestDb, seedOperator, seedUser, type TestDb } from './testing/pg';

/**
 * Права support_operator проверяются НА УРОВНЕ ЗАПРОСОВ: контекст клиента
 * для этой роли собирается запросами без денежных колонок (смотрим и в
 * ответ, и в текст выполненного SQL), а не прячется в интерфейсе.
 */

const S = { ...DEFAULT_SUPPORT_SETTINGS, hours: { ...DEFAULT_SUPPORT_SETTINGS.hours, alwaysOpen: true } };
let db: TestDb;
let userId: string;

beforeEach(async () => {
  db = await createTestDb();
  userId = await seedUser(db, { email: 'rich@client.test', name: 'Богдан Богатов' });
  // Деньги клиента: реальный счёт, депозит и вывод с суммами/адресами/хэшами, KYC-документ.
  await db.query(`INSERT INTO real_accounts (user_id, balance_cents, currency) VALUES ($1, 4825013, 'USDT')`, [userId]);
  await db.query(
    `INSERT INTO crypto_deposits (user_id, tx_hash, status, amount_minor, from_address) VALUES ($1, $2, 'credited', 100000, 'TFromAddr')`,
    [userId, 'a'.repeat(64)],
  );
  await db.query(
    `INSERT INTO crypto_withdrawals (user_id, to_address, amount_minor, status) VALUES ($1, 'TWithdrawAddrSecret', 25000, 'requested')`,
    [userId],
  );
  await db.query(`INSERT INTO client_money_flags (user_id, withdraw_banned) VALUES ($1, true)`, [userId]);
  await db.query(`INSERT INTO client_verification (user_id, state) VALUES ($1, 'pending')`, [userId]);
  await db.query(
    `INSERT INTO kyc_documents (id, user_id, doc_kind, storage_key, content_type) VALUES (gen_random_uuid(), $1, 'identity', 'kyc/t/u/identity/secret-key', 'image/png')`,
    [userId],
  );
});
afterEach(async () => db.close());

describe('support_operator — без денег и KYC-документов', () => {
  it('контекст: статусы есть, сумм/балансов/адресов/хэшей/ключей документов нет — ни в ответе, ни в SQL', async () => {
    db.log.length = 0;
    const ctx = await loadClientContext(db, 'support_operator', userId);
    expect(ctx).toMatchObject({
      fullName: 'Богдан Богатов',
      kycState: 'pending',
      withdrawBanned: true,
      frozen: false,
      hasRealAccount: true,
      redacted: { money: true, kycDocuments: true },
    });
    expect(ctx!.recentMoney.map((m) => [m.kind, m.status])).toEqual(
      expect.arrayContaining([
        ['deposit', 'credited'],
        ['withdrawal', 'requested'],
      ]),
    );
    const json = JSON.stringify(ctx);
    for (const leak of ['4825013', '100000', '25000', 'TWithdrawAddrSecret', 'TFromAddr', 'a'.repeat(64), 'secret-key']) {
      expect(json).not.toContain(leak);
    }
    expect(ctx).not.toHaveProperty('realBalanceMinor');
    expect(ctx).not.toHaveProperty('kycDocumentCount');
    for (const m of ctx!.recentMoney) {
      expect(m).not.toHaveProperty('amountMinor');
      expect(m).not.toHaveProperty('ref');
    }
    const sql = db.log.join('\n');
    for (const col of MONEY_COLUMNS_FORBIDDEN_FOR_SUPPORT) expect(sql).not.toContain(col);
    expect(sql).not.toContain('kyc_documents');
  });

  it('тот же контекст для operator — суммы и адреса есть (проверка умеет краснеть)', async () => {
    const ctx = await loadClientContext(db, 'operator', userId);
    expect(ctx?.realBalanceMinor).toBe(4825013);
    expect(ctx?.kycDocumentCount).toBe(1);
    expect(JSON.stringify(ctx)).toContain('TWithdrawAddrSecret');
  });

  it('finance_operator видит суммы, но не KYC-документы', async () => {
    const ctx = await loadClientContext(db, 'finance_operator', userId);
    expect(ctx?.realBalanceMinor).toBe(4825013);
    expect(ctx?.redacted).toEqual({ money: false, kycDocuments: true });
    expect(ctx).not.toHaveProperty('kycDocumentCount');
  });

  it('неизвестная роль — контекста нет вовсе (fail-closed)', async () => {
    expect(await loadClientContext(db, null, userId)).toBeNull();
    expect(asSupportRole('superuser')).toBeNull();
    expect(supportAccess.worksTickets(null)).toBe(false);
  });

  it('настройки и шаблоны — только admin', async () => {
    const sup: Actor = { operatorId: await seedOperator(db, 'support_operator'), role: 'support_operator' };
    const adm: Actor = { operatorId: await seedOperator(db, 'admin'), role: 'admin' };
    expect(await saveSupportSettings(db, sup, DEFAULT_SUPPORT_SETTINGS, 'x')).toEqual({ ok: false, reason: 'forbidden' });
    expect(await saveTemplate(db, sup, { key: 'a', locale: 'ru', title: 't', body: 'b', active: true })).toEqual({ ok: false, reason: 'forbidden' });
    expect(await saveSupportSettings(db, adm, DEFAULT_SUPPORT_SETTINGS, '')).toEqual({ ok: false, reason: 'reasonRequired' });
    expect(await saveSupportSettings(db, adm, DEFAULT_SUPPORT_SETTINGS, 'часы для показа')).toEqual({ ok: true });
    const j = await db.query(`SELECT payload FROM admin_action_journal WHERE action = 'support.settings.updated'`);
    expect(j.rows[0]!.payload).toHaveProperty('before');
    expect(j.rows[0]!.payload).toHaveProperty('after');
  });
});

describe('finance_operator — только назначенные ему', () => {
  it('в очереди и по ссылке видит только своё; отвечать в чужой — forbidden', async () => {
    const t1 = await postClientChatMessage(db, S, { userId, body: 'Где мой вывод?' });
    if (!t1.ok) throw new Error();
    const fin: Actor = { operatorId: await seedOperator(db, 'finance_operator'), role: 'finance_operator' };
    const sup: Actor = { operatorId: await seedOperator(db, 'support_operator'), role: 'support_operator' };

    expect((await listQueue(db, fin, { filter: 'all' })).total).toBe(0);
    expect((await queueStats(db, fin)).awaiting).toBe(0);
    expect(await getTicketForOperator(db, fin, String(t1.number))).toBeNull();
    expect(await operatorReply(db, S, fin, { ticketId: t1.ticketId, body: 'x' })).toEqual({ ok: false, reason: 'forbidden' });

    // Эскалация «в финансы» — назначение.
    expect(await assignTicket(db, sup, { ticketId: t1.ticketId, assigneeId: fin.operatorId })).toEqual({ ok: true });
    expect((await listQueue(db, fin, { filter: 'all' })).total).toBe(1);
    expect(await getTicketForOperator(db, fin, String(t1.number))).not.toBeNull();
    expect(await operatorReply(db, S, fin, { ticketId: t1.ticketId, body: 'Вывод в обработке' })).toMatchObject({ ok: true });
  });

  it('вложение чужого тикета finance_operator не получает', async () => {
    const t1 = await postClientChatMessage(db, S, {
      userId,
      body: 'Скрин',
      attachments: [{ objectKey: 'support/t/x/1', filename: 'a.png', mime: 'image/png', sizeBytes: 10, sha256: 'f'.repeat(64) }],
    });
    if (!t1.ok) throw new Error();
    const att = await db.query(`SELECT id FROM support_attachments`);
    const fin: Actor = { operatorId: await seedOperator(db, 'finance_operator'), role: 'finance_operator' };
    const sup: Actor = { operatorId: await seedOperator(db, 'support_operator'), role: 'support_operator' };
    expect(await findAttachmentForOperator(db, fin, String(att.rows[0]!.id))).toBeNull();
    expect(await findAttachmentForOperator(db, sup, String(att.rows[0]!.id))).toMatchObject({ filename: 'a.png' });
  });
});

describe('переходы статусов', () => {
  it('матрица: закрытый только переоткрывается; спам — из любого активного', () => {
    expect(allowedTransitions('closed')).toEqual(['open']);
    expect(canTransition('new', 'spam')).toBe(true);
    expect(canTransition('new', 'closed')).toBe(false);
    expect(canTransition('resolved', 'closed')).toBe(true);
    expect(canTransition('spam', 'resolved')).toBe(false);
  });
});
