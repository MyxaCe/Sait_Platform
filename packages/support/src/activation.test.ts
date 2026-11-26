import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  completePasswordReset,
  confirmEmail,
  issueEmailVerifyMail,
  LIMIT_PER_EMAIL_PER_HOUR,
  purgeUnactivatedUsers,
  requestActivationLink,
  requestPasswordReset,
  RESEND_MIN_INTERVAL_SECONDS,
  UNACTIVATED_TTL_DAYS,
  VERIFY_TTL_HOURS,
} from './auth-mail';
import { DEFAULT_SUPPORT_SETTINGS } from './settings';
import { createTestDb, seedUser, type TestDb } from './testing/pg';

// Регистрация только с подтверждённой почтой (решение владельца 26.11).

const S = DEFAULT_SUPPORT_SETTINGS;
const link = (p: string, token: string, locale: string) => `https://cab.test/${locale}${p}?token=${token}`;
const T0 = new Date('2026-11-26T10:00:00Z');
const later = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

let db: TestDb;
afterEach(async () => db.close());

async function newClient(email = 'anna@client.test'): Promise<string> {
  const id = await seedUser(db, { email, name: 'Анна Клиентова' });
  await db.query(`UPDATE users SET created_at = $2 WHERE id = $1`, [id, T0]);
  return id;
}

async function registrationMail(userId: string, email = 'anna@client.test', now = T0): Promise<void> {
  await issueEmailVerifyMail(db, S, { user: { id: userId, email, fullName: 'Анна Клиентова', locale: 'ru' }, link, ip: null, now });
}

async function tokens(): Promise<string[]> {
  const r = await db.query(`SELECT body_text FROM outbound_mail WHERE purpose = 'email_verify' ORDER BY created_at`);
  return r.rows.map((x) => /token=([A-Za-z0-9_-]+)/.exec(String(x.body_text))![1]!);
}

async function mailCount(): Promise<number> {
  return Number((await db.query(`SELECT count(*)::int AS n FROM outbound_mail`)).rows[0]!.n);
}

async function activatedAt(id: string): Promise<unknown> {
  return (await db.query(`SELECT activated_at FROM users WHERE id = $1`, [id])).rows[0]!.activated_at;
}

describe('миграция 1796560000000_users_activated', () => {
  beforeEach(async () => {
    db = await createTestDb();
  });

  it('все, кто уже есть в базе, считаются активированными; повторный прогон ничего не ломает', async () => {
    const a = await newClient('a@client.test');
    const b = await newClient('b@client.test');
    await db.query(`UPDATE users SET email_verified_at = $2 WHERE id = $1`, [a, later(60)]);
    expect(await activatedAt(a)).toBeNull();
    const sql = readFileSync(path.resolve(__dirname, '../../db/migrations/1796560000000_users_activated.sql'), 'utf8');
    await db.pg.exec(sql);
    expect(new Date(String(await activatedAt(a))).toISOString()).toBe(later(60).toISOString());
    expect(new Date(String(await activatedAt(b))).toISOString()).toBe(T0.toISOString());
    await db.pg.exec(sql);
    expect(new Date(String(await activatedAt(a))).toISOString()).toBe(later(60).toISOString());
  });
});

describe('подтверждение почты при регистрации', () => {
  let userId: string;
  beforeEach(async () => {
    db = await createTestDb();
    userId = await newClient();
    await registrationMail(userId);
  });

  it('ссылка из письма активирует учётную запись один раз; двойной клик — usedToken', async () => {
    expect(await activatedAt(userId)).toBeNull();
    const [token] = await tokens();
    expect(await confirmEmail(db, { token: token!, now: later(30) })).toEqual({
      ok: true,
      userId,
      activatedNow: true,
      twoFactor: false,
    });
    expect(await activatedAt(userId)).not.toBeNull();
    expect(await confirmEmail(db, { token: token!, now: later(31) })).toEqual({ ok: false, reason: 'usedToken' });
    const j = await db.query(`SELECT action, payload FROM admin_action_journal WHERE subject_id = $1 ORDER BY seq`, [userId]);
    expect(j.rows.map((r) => r.action)).toEqual(['auth.email_verify.confirmed']);
    expect(j.rows[0]!.payload).toEqual({ activated: true });
  });

  it('в базе только хеш токена; просроченная ссылка не активирует', async () => {
    const [token] = await tokens();
    const stored = await db.query(`SELECT token_hash FROM auth_mail_tokens WHERE user_id = $1`, [userId]);
    expect(stored.rows[0]!.token_hash).not.toBe(token);
    expect(await confirmEmail(db, { token: token!, now: later(VERIFY_TTL_HOURS * 3600 + 1) })).toEqual({
      ok: false,
      reason: 'expiredToken',
    });
    expect(await activatedAt(userId)).toBeNull();
  });

  it('после подтверждения остальные ссылки из прежних писем гаснут', async () => {
    await registrationMail(userId, 'anna@client.test', later(120));
    const [first, second] = await tokens();
    expect((await confirmEmail(db, { token: second!, now: later(130) })).ok).toBe(true);
    expect(await confirmEmail(db, { token: first!, now: later(131) })).toEqual({ ok: false, reason: 'usedToken' });
  });

  it('подтверждение нового адреса у уже активированного клиента не «активирует заново»; 2FA видна', async () => {
    const [token] = await tokens();
    await confirmEmail(db, { token: token!, now: later(30) });
    await db.query(`UPDATE users SET email = 'new@client.test', email_verified_at = NULL WHERE id = $1`, [userId]);
    await db.query(
      `INSERT INTO client_totp (user_id, secret_enc, enabled_at) VALUES ($1, 'v1.x.y.z', now())`,
      [userId],
    );
    await registrationMail(userId, 'new@client.test', later(300));
    const all = await tokens();
    const r = await confirmEmail(db, { token: all[all.length - 1]!, now: later(310) });
    expect(r).toEqual({ ok: true, userId, activatedNow: false, twoFactor: true });
  });

  it('сброс пароля по ссылке из письма тоже доказывает владение адресом и активирует', async () => {
    await requestPasswordReset(db, S, { email: 'anna@client.test', ip: null, link, now: later(5) });
    const r = await db.query(`SELECT body_text FROM outbound_mail WHERE purpose = 'password_reset'`);
    const token = /token=([A-Za-z0-9_-]+)/.exec(String(r.rows[0]!.body_text))![1]!;
    expect((await completePasswordReset(db, { token, passwordHash: 'NEW', now: later(10) })).ok).toBe(true);
    expect(await activatedAt(userId)).not.toBeNull();
  });
});

describe('повторная ссылка: интервал, лимит, без раскрытия адресов', () => {
  let userId: string;
  beforeEach(async () => {
    db = await createTestDb();
    userId = await newClient();
    await registrationMail(userId);
  });

  it('не чаще раза в минуту на адрес', async () => {
    const soon = await requestActivationLink(db, S, { email: 'Anna@Client.test', ip: '1.1.1.1', link, now: later(RESEND_MIN_INTERVAL_SECONDS - 1) });
    expect(soon.internal).toBe('tooSoon');
    const ok = await requestActivationLink(db, S, { email: 'anna@client.test', ip: '1.1.1.1', link, now: later(RESEND_MIN_INTERVAL_SECONDS + 1) });
    expect(ok.internal).toBe('sent');
    expect(await mailCount()).toBe(2);
  });

  it(`не больше ${LIMIT_PER_EMAIL_PER_HOUR} писем за час на адрес (вместе с письмом регистрации)`, async () => {
    const results: string[] = [];
    for (let i = 1; i <= 5; i++) {
      results.push((await requestActivationLink(db, S, { email: 'anna@client.test', ip: null, link, now: later(i * 120) })).internal);
    }
    expect(results.filter((r) => r === 'sent')).toHaveLength(LIMIT_PER_EMAIL_PER_HOUR - 1);
    expect(results.at(-1)).toBe('rateLimited');
    expect(await mailCount()).toBe(LIMIT_PER_EMAIL_PER_HOUR);
  });

  it('неизвестный и уже подтверждённый адрес: тот же ответ, письма нет, интервал считается так же', async () => {
    const unknown = await requestActivationLink(db, S, { email: 'nobody@client.test', ip: null, link, now: later(120) });
    expect(unknown.ok).toBe(true);
    expect(unknown.internal).toBe('unknownEmail');
    const again = await requestActivationLink(db, S, { email: 'nobody@client.test', ip: null, link, now: later(130) });
    expect(again.internal).toBe('tooSoon');

    const [token] = await tokens();
    await confirmEmail(db, { token: token!, now: later(140) });
    const verified = await requestActivationLink(db, S, { email: 'anna@client.test', ip: null, link, now: later(300) });
    expect(verified.ok).toBe(true);
    expect(verified.internal).toBe('alreadyVerified');
    expect(await mailCount()).toBe(1);
    expect(await activatedAt(userId)).not.toBeNull();
  });

  it('мусор вместо адреса — invalid, без записи', async () => {
    expect((await requestActivationLink(db, S, { email: 'not-an-email', ip: null, link, now: later(120) })).internal).toBe('invalid');
  });
});

describe('удаление неподтверждённых регистраций', () => {
  beforeEach(async () => {
    db = await createTestDb();
  });

  const old = later(-(UNACTIVATED_TTL_DAYS * 86400 + 3600));

  async function aged(email: string): Promise<string> {
    const id = await seedUser(db, { email });
    await db.query(`UPDATE users SET created_at = $2 WHERE id = $1`, [id, old]);
    return id;
  }

  it('удаляет старше 7 дней вместе со служебными строками; свежих, активированных и входивших не трогает', async () => {
    const stale = await aged('stale@client.test');
    await issueEmailVerifyMail(db, S, { user: { id: stale, email: 'stale@client.test', fullName: 'X', locale: 'ru' }, link, ip: null, now: old });
    await db.query(`INSERT INTO notifications (id, user_id, type, params) VALUES (gen_random_uuid(), $1, 'welcome', '{}')`, [stale]);
    await db.query(
      `INSERT INTO user_legal_acceptances (user_id, document_slug, document_version, document_title, source, context, locale, ip)
       VALUES ($1, 'terms', 'v1', 'Условия', 'cms', 'registration', 'ru', null)`,
      [stale],
    );
    await db.query(`INSERT INTO client_leverage (user_id, portfolio_key) VALUES ($1, (SELECT key FROM leverage_portfolios LIMIT 1))`, [stale]).catch(() => {});

    const fresh = await newClient('fresh@client.test');
    const activated = await aged('active@client.test');
    await db.query(`UPDATE users SET activated_at = $2 WHERE id = $1`, [activated, old]);
    const loggedIn = await aged('logged@client.test');
    await db.query(`UPDATE users SET last_login_at = $2 WHERE id = $1`, [loggedIn, old]);

    const r = await purgeUnactivatedUsers(db, { now: T0 });
    expect(r).toEqual({ deleted: 1, skipped: [] });
    const left = await db.query(`SELECT id FROM users ORDER BY email`);
    expect(left.rows.map((x) => x.id).sort()).toEqual([activated, fresh, loggedIn].sort());
    for (const t of ['notifications', 'user_legal_acceptances', 'auth_mail_tokens', 'client_leverage']) {
      const n = await db.query(`SELECT count(*)::int AS n FROM ${t} WHERE user_id = $1`, [stale]);
      expect(n.rows[0]!.n, t).toBe(0);
    }
    const j = await db.query(`SELECT action, payload FROM admin_action_journal WHERE action = 'auth.unactivated.purged'`);
    expect(j.rows).toHaveLength(1);
    expect(j.rows[0]!.payload).toEqual({ deleted: 1, olderThanDays: UNACTIVATED_TTL_DAYS });
  });

  it('пользователь с обращением в поддержку не удаляется молча — пропуск с причиной', async () => {
    const stale = await aged('stale@client.test');
    await db.query(
      `INSERT INTO support_tickets (user_id, contact_email, locale, origin_channel, reply_channel, subject, status)
       VALUES ($1, 'stale@client.test', 'ru', 'web_form', 'email', 'Не пришло письмо', 'new')`,
      [stale],
    );
    const r = await purgeUnactivatedUsers(db, { now: T0 });
    expect(r.deleted).toBe(0);
    expect(r.skipped).toEqual([{ userId: stale, reason: 'есть строки: support_tickets' }]);
    expect((await db.query(`SELECT count(*)::int AS n FROM users`)).rows[0]!.n).toBe(1);
  });

  it('нечего удалять — журнал не пишется', async () => {
    await newClient('fresh@client.test');
    expect(await purgeUnactivatedUsers(db, { now: T0 })).toEqual({ deleted: 0, skipped: [] });
    expect((await db.query(`SELECT count(*)::int AS n FROM admin_action_journal`)).rows[0]!.n).toBe(0);
  });
});
