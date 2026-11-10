import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  completePasswordReset,
  confirmEmail,
  inspectToken,
  LIMIT_PER_EMAIL_PER_HOUR,
  requestEmailVerification,
  requestPasswordReset,
  RESET_TTL_MINUTES,
} from './auth-mail';
import { recoverContactLeads } from './leads';
import { DEFAULT_SUPPORT_SETTINGS } from './settings';
import { createWebFormTicketTx } from './tickets';
import { createTestDb, seedUser, type TestDb } from './testing/pg';

const S = DEFAULT_SUPPORT_SETTINGS;
let db: TestDb;
let userId: string;
const link = (path: string, token: string, locale: string) => `https://cab.test/${locale}${path}?token=${token}`;

beforeEach(async () => {
  db = await createTestDb();
  userId = await seedUser(db, { email: 'Anna@Client.test', name: 'Анна Клиентова' });
  await db.query(`INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (gen_random_uuid(), $1, 'h', now() + interval '1 day')`, [userId]);
});
afterEach(async () => db.close());

async function lastToken(): Promise<string> {
  const r = await db.query(`SELECT body_text FROM outbound_mail ORDER BY created_at DESC LIMIT 1`);
  const m = /token=([A-Za-z0-9_-]+)/.exec(String(r.rows[0]!.body_text));
  return m![1]!;
}

describe('сброс пароля', () => {
  it('не раскрывает существование email: ответ одинаковый, письмо — только существующему', async () => {
    const known = await requestPasswordReset(db, S, { email: 'anna@client.test', ip: '1.1.1.1', link });
    const unknown = await requestPasswordReset(db, S, { email: 'nobody@client.test', ip: '1.1.1.1', link });
    // Наружу уходит только `ok: true` — `internal` для лога/тестов, форма его не показывает.
    expect(known.ok).toBe(true);
    expect(unknown.ok).toBe(true);
    expect(known.internal).toBe('sent');
    expect(unknown.internal).toBe('unknownEmail');
    const mails = await db.query(`SELECT to_address, purpose, subject FROM outbound_mail`);
    expect(mails.rows).toEqual([{ to_address: 'anna@client.test', purpose: 'password_reset', subject: 'Сброс пароля' }]);
    // В базе — только хеш токена.
    const token = await lastToken();
    const stored = await db.query(`SELECT token_hash FROM auth_mail_tokens WHERE user_id = $1`, [userId]);
    expect(stored.rows[0]!.token_hash).not.toBe(token);
    expect(stored.rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('токен одноразовый: смена пароля, гашение сессий; второй раз — usedToken', async () => {
    await requestPasswordReset(db, S, { email: 'anna@client.test', ip: null, link });
    const token = await lastToken();
    expect(await inspectToken(db, 'password_reset', token)).toEqual({ ok: true, userId });
    expect(await completePasswordReset(db, { token, passwordHash: 'NEW' })).toEqual({ ok: true, userId });
    expect((await db.query(`SELECT password_hash FROM users`)).rows[0]!.password_hash).toBe('NEW');
    expect((await db.query(`SELECT count(*)::int AS n FROM sessions`)).rows[0]!.n).toBe(0);
    expect(await completePasswordReset(db, { token, passwordHash: 'AGAIN' })).toEqual({ ok: false, reason: 'usedToken' });
    expect((await db.query(`SELECT password_hash FROM users`)).rows[0]!.password_hash).toBe('NEW');
    const j = await db.query(`SELECT action FROM admin_action_journal WHERE subject_id = $1 ORDER BY seq`, [userId]);
    expect(j.rows.map((x) => x.action)).toEqual(['auth.password_reset.requested', 'auth.password_reset.completed']);
  });

  it('срок жизни: после TTL — expiredToken; чужой/кривой — invalidToken', async () => {
    await requestPasswordReset(db, S, { email: 'anna@client.test', ip: null, link });
    const token = await lastToken();
    const later = new Date(Date.now() + (RESET_TTL_MINUTES + 1) * 60_000);
    expect(await completePasswordReset(db, { token, passwordHash: 'X', now: later })).toEqual({ ok: false, reason: 'expiredToken' });
    expect(await completePasswordReset(db, { token: 'garbage', passwordHash: 'X' })).toEqual({ ok: false, reason: 'invalidToken' });
  });

  it('новая ссылка гасит старую после успешного сброса', async () => {
    await requestPasswordReset(db, S, { email: 'anna@client.test', ip: null, link });
    const first = await lastToken();
    await requestPasswordReset(db, S, { email: 'anna@client.test', ip: null, link });
    const second = await lastToken();
    expect(await completePasswordReset(db, { token: second, passwordHash: 'N' })).toMatchObject({ ok: true });
    expect(await completePasswordReset(db, { token: first, passwordHash: 'M' })).toEqual({ ok: false, reason: 'usedToken' });
  });

  it('лимит частоты по email (и для несуществующего — тоже, ответ тот же)', async () => {
    for (let i = 0; i < LIMIT_PER_EMAIL_PER_HOUR; i++) {
      expect((await requestPasswordReset(db, S, { email: 'anna@client.test', ip: `9.9.9.${i}`, link })).internal).toBe('sent');
    }
    const r = await requestPasswordReset(db, S, { email: 'anna@client.test', ip: '9.9.9.99', link });
    expect(r).toEqual({ ok: true, internal: 'rateLimited' });
    expect((await db.query(`SELECT count(*)::int AS n FROM outbound_mail`)).rows[0]!.n).toBe(LIMIT_PER_EMAIL_PER_HOUR);
  });

  it('лимит частоты по IP — перебор адресов с одного IP упирается', async () => {
    let limited = 0;
    for (let i = 0; i < 12; i++) {
      const r = await requestPasswordReset(db, S, { email: `x${i}@client.test`, ip: '6.6.6.6', link });
      if (r.internal === 'rateLimited') limited++;
    }
    expect(limited).toBe(2);
  });
});

describe('подтверждение email', () => {
  it('письмо → ссылка → email_verified_at; повтор — usedToken; уже подтверждён — alreadyVerified', async () => {
    expect(await requestEmailVerification(db, S, { userId, ip: null, link })).toBe('sent');
    const token = await lastToken();
    expect((await db.query(`SELECT subject FROM outbound_mail`)).rows[0]!.subject).toBe('Подтвердите email');
    expect(await confirmEmail(db, { token })).toEqual({ ok: true, userId });
    expect((await db.query(`SELECT email_verified_at FROM users`)).rows[0]!.email_verified_at).not.toBeNull();
    expect(await confirmEmail(db, { token })).toEqual({ ok: false, reason: 'usedToken' });
    expect(await requestEmailVerification(db, S, { userId, ip: null, link })).toBe('alreadyVerified');
  });

  it('клиент сменил email после отправки — старая ссылка новый адрес не подтверждает', async () => {
    await requestEmailVerification(db, S, { userId, ip: null, link });
    const token = await lastToken();
    await db.query(`UPDATE users SET email = 'new@client.test'`);
    expect(await confirmEmail(db, { token })).toEqual({ ok: false, reason: 'invalidToken' });
    expect((await db.query(`SELECT email_verified_at FROM users`)).rows[0]!.email_verified_at).toBeNull();
  });
});

describe('восстановление потерянных обращений (leads → тикеты)', () => {
  async function lead(email: string, topic: string, message: string, daysAgo: number) {
    await db.query(
      `INSERT INTO leads (kind, email, locale, payload, created_at) VALUES ('contact', $1, 'ru', $2, now() - ($3 || ' days')::interval)`,
      [email, JSON.stringify({ kind: 'contact', name: 'Пётр', email, topic, message }), String(daysAgo)],
    );
  }

  it('каждое contact-обращение без тикета → тикет web_form с исходной датой; повтор ничего не дублирует', async () => {
    await lead('p1@client.test', 'Вывод', 'Где деньги?', 5);
    await lead('p2@client.test', 'Счёт', 'Как открыть счёт?', 3);
    await db.query(`INSERT INTO leads (kind, email, payload) VALUES ('account-opening', 'acc@client.test', '{}')`);

    const first = await recoverContactLeads(db, S);
    expect(first.recovered).toBe(2);
    const t = await db.query(
      `SELECT origin_channel, reply_channel, contact_email, subject, status, source_lead_id IS NOT NULL AS linked,
              created_at < now() - interval '2 days' AS backdated FROM support_tickets ORDER BY created_at`,
    );
    expect(t.rows).toEqual([
      { origin_channel: 'web_form', reply_channel: 'email', contact_email: 'p1@client.test', subject: 'Вывод', status: 'new', linked: true, backdated: true },
      { origin_channel: 'web_form', reply_channel: 'email', contact_email: 'p2@client.test', subject: 'Счёт', status: 'new', linked: true, backdated: true },
    ]);
    // Подтверждение задним числом не шлём.
    expect((await db.query(`SELECT count(*)::int AS n FROM outbound_mail`)).rows[0]!.n).toBe(0);

    expect(await recoverContactLeads(db, S)).toEqual({ recovered: 0, numbers: [] });
    expect((await db.query(`SELECT count(*)::int AS n FROM support_tickets`)).rows[0]!.n).toBe(2);
    const j = await db.query(`SELECT payload FROM admin_action_journal WHERE action = 'support.leads.recovered'`);
    expect(j.rows).toHaveLength(1);
    expect(j.rows[0]!.payload).toMatchObject({ count: 2 });
  });

  it('лид, для которого форма уже создала тикет, не восстанавливается повторно', async () => {
    await lead('p3@client.test', 'Тема', 'Текст', 0);
    const l = await db.query(`SELECT id FROM leads`);
    const r = await createWebFormTicketTx(db, S, {
      name: 'Пётр',
      email: 'p3@client.test',
      subject: 'Тема',
      body: 'Текст',
      locale: 'ru',
      leadId: String(l.rows[0]!.id),
    });
    expect(r.ok).toBe(true);
    expect((await recoverContactLeads(db, S)).recovered).toBe(0);
  });
});
