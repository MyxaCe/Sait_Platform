import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SUPPORT_SETTINGS, enqueueMail, type SupportSettings } from '@broker/support';
import { createTestDb, type TestDb } from '@broker/support/testing';
import { readMailConfig } from './config';
import { handleRawMessage, parseInbound, type ObjectStore } from './inbound';
import { composeRaw, isPermanent, sendTick, type RawTransport } from './sender';

const S: SupportSettings = { ...DEFAULT_SUPPORT_SETTINGS, hours: { ...DEFAULT_SUPPORT_SETTINGS.hours, alwaysOpen: true } };
const META = { mailbox: 'INBOX', uid: 7, uidValidity: 1, tenant: 'apex-ru' };

describe('конфигурация из env', () => {
  it('без env почта выключена, недостающие названы (без значений)', () => {
    const c = readMailConfig({});
    expect(c.smtp).toBeNull();
    expect(c.imap).toBeNull();
    expect(c.missing).toEqual([
      'SUPPORT_MAIL_ADDRESS',
      'SUPPORT_SMTP_HOST',
      'SUPPORT_SMTP_USER',
      'SUPPORT_SMTP_PASSWORD',
      'SUPPORT_IMAP_HOST',
      'SUPPORT_IMAP_USER',
      'SUPPORT_IMAP_PASSWORD',
    ]);
  });

  it('пустая строка — отсутствие; 465 — TLS, 587 — STARTTLS; проверка сертификата по умолчанию включена', () => {
    const base = {
      SUPPORT_MAIL_ADDRESS: 'support@wholesalefy.com',
      SUPPORT_SMTP_HOST: 'mail.wholesalefy.com',
      SUPPORT_SMTP_USER: 'support@wholesalefy.com',
      SUPPORT_SMTP_PASSWORD: 'p',
    };
    expect(readMailConfig({ ...base, SUPPORT_SMTP_PASSWORD: ' ' }).smtp).toBeNull();
    expect(readMailConfig(base).smtp).toMatchObject({ port: 465, secure: true, rejectUnauthorized: true });
    expect(readMailConfig({ ...base, SUPPORT_SMTP_PORT: '587' }).smtp).toMatchObject({ port: 587, secure: false });
    expect(readMailConfig({ ...base, SUPPORT_SMTP_TLS_VERIFY: 'false' }).smtp?.rejectUnauthorized).toBe(false);
    expect(readMailConfig(base).imap).toBeNull();
  });
});

describe('отправка очереди', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await createTestDb();
  });
  afterEach(async () => db.close());

  const from = { address: 'support@wholesalefy.com', name: 'Поддержка' };

  async function queue(purpose: 'support_reply' | 'support_ack' | 'password_reset' = 'support_reply') {
    return enqueueMail(db, { purpose, to: 'c@client.example', subject: 'Re: Вопрос [#1001]', bodyText: 'Ответ', inReplyTo: '<m1@client.example>' });
  }

  it('успех: письмо ушло, Message-ID наш, копия в Sent; auth-письмо в Sent НЕ копируется', async () => {
    await queue();
    await queue('password_reset');
    const sentRaw: Buffer[] = [];
    const appended: Buffer[] = [];
    const transport: RawTransport = { send: async (raw) => (sentRaw.push(raw), { response: '250 OK' }) };
    const r = await sendTick({ db, transport, sentCopy: { append: async (b) => void appended.push(b) }, from, domain: 'wholesalefy.com', perHour: 100, supportEmailEnabled: true });
    expect(r).toMatchObject({ sent: 2, failed: 0, retry: 0 });
    expect(appended).toHaveLength(1);
    const text = sentRaw.map((b) => b.toString('utf8')).join('\n');
    expect(text).toMatch(/Message-ID: <[0-9a-f-]{36}@wholesalefy\.com>/);
    expect(text).toContain('In-Reply-To: <m1@client.example>');
    expect(text).toContain('Auto-Submitted: auto-generated');
    const rows = await db.query(`SELECT status FROM outbound_mail`);
    expect(rows.rows.every((x) => x.status === 'sent')).toBe(true);
  });

  it('сбой SMTP: повтор (временная) / failed (5xx — постоянная)', async () => {
    await queue();
    const tempErr = Object.assign(new Error('421 too many'), { responseCode: 421 });
    let r = await sendTick({ db, transport: { send: async () => { throw tempErr; } }, from, domain: 'd', perHour: 100, supportEmailEnabled: true });
    expect(r).toMatchObject({ sent: 0, retry: 1 });
    expect((await db.query(`SELECT status, attempts FROM outbound_mail`)).rows[0]).toEqual({ status: 'queued', attempts: 1 });
    await db.query(`UPDATE outbound_mail SET next_attempt_at = now()`);
    const permErr = Object.assign(new Error('550 no such user'), { responseCode: 550 });
    r = await sendTick({ db, transport: { send: async () => { throw permErr; } }, from, domain: 'd', perHour: 100, supportEmailEnabled: true });
    expect(r).toMatchObject({ failed: 1 });
    expect((await db.query(`SELECT status, last_error FROM outbound_mail`)).rows[0]).toEqual({ status: 'failed', last_error: '550 no such user' });
    expect(isPermanent({ responseCode: 552 })).toBe(false);
  });

  it('лимит хостинга в час — не шлём сверх; канал поддержки выключен — уходят только auth-письма', async () => {
    await queue();
    await queue('password_reset');
    const sent: string[] = [];
    const transport: RawTransport = { send: async (raw) => (sent.push(raw.toString()), { response: '250' }) };
    const r1 = await sendTick({ db, transport, from, domain: 'd', perHour: 100, supportEmailEnabled: false });
    expect(r1.sent).toBe(1);
    expect((await db.query(`SELECT purpose, status FROM outbound_mail ORDER BY purpose`)).rows).toEqual([
      { purpose: 'password_reset', status: 'sent' },
      { purpose: 'support_reply', status: 'queued' },
    ]);
    const r2 = await sendTick({ db, transport, from, domain: 'd', perHour: 1, supportEmailEnabled: true });
    expect(r2).toMatchObject({ sent: 0, throttled: true });
  });

  it('автоответ помечен Auto-Submitted: auto-replied (RFC 3834)', async () => {
    const raw = await composeRaw(
      { id: 'x', purpose: 'support_ack', ticketId: null, to: 'a@b.c', subject: 'S', bodyText: 'B', inReplyTo: null, references: [], rfcMessageId: '<x@d>', attempts: 1 },
      from,
    );
    expect(raw.toString()).toContain('Auto-Submitted: auto-replied');
  });
});

describe('разбор входящего письма', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await createTestDb();
  });
  afterEach(async () => db.close());

  const store = (): ObjectStore & { keys: string[] } => {
    const keys: string[] = [];
    return { keys, put: async (k) => void keys.push(k) };
  };

  const RAW = [
    'From: =?UTF-8?B?0JDQvdC90LA=?= <anna@client.example>',
    'To: support@wholesalefy.com',
    'Subject: =?UTF-8?B?0J3QtSDQv9GA0LjRhdC+0LTQuNGCINC60L7QtA==?=',
    'Message-ID: <abc123@client.example>',
    'Date: Tue, 10 Nov 2026 10:00:00 +0000',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="b1"',
    '',
    '--b1',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<p>Здравствуйте! <img src="https://tracker.example/x.png">Код не приходит.</p>',
    '--b1',
    'Content-Type: image/png; name="screen.png"',
    'Content-Disposition: attachment; filename="screen.png"',
    'Content-Transfer-Encoding: base64',
    '',
    'iVBORw0KGgo=',
    '--b1',
    'Content-Type: application/x-msdownload; name="virus.exe"',
    'Content-Disposition: attachment; filename="virus.exe"',
    'Content-Transfer-Encoding: base64',
    '',
    'TVqQAAMAAAAEAAAA',
    '--b1--',
    '',
  ].join('\r\n');

  it('HTML → только текст, картинки не грузятся; разрешённое вложение сохранено, .exe — только упоминание; сырое .eml сохранено', async () => {
    const st = store();
    const p = await parseInbound(Buffer.from(RAW), META, S, st);
    expect(p.mail.from).toEqual({ address: 'anna@client.example', name: 'Анна' });
    expect(p.mail.subject).toBe('Не приходит код');
    expect(p.mail.text).toContain('Здравствуйте! Код не приходит.');
    expect(p.mail.text).not.toContain('tracker.example');
    expect(p.mail.text).toContain('«virus.exe»');
    expect(p.mail.attachments).toHaveLength(1);
    expect(p.mail.attachments![0]).toMatchObject({ filename: 'screen.png', mime: 'image/png' });
    expect(st.keys[0]).toMatch(/^support-raw\/apex-ru\/\d{4}-\d{2}\/[0-9a-f-]{36}\.eml$/);
    expect(st.keys[1]).toMatch(/^support\/apex-ru\/mail\/[0-9a-f-]{36}$/);
  });

  it('обработка целиком: тикет с вложением; тот же .eml второй раз — дубль', async () => {
    const ctx = { settings: S, ownAddresses: ['support@wholesalefy.com'], store: store() };
    const r1 = await handleRawMessage(db, Buffer.from(RAW), META, ctx);
    expect(r1).toMatchObject({ ok: true, verdict: { verdict: 'accepted', created: true } });
    expect((await db.query(`SELECT count(*)::int AS n FROM support_attachments`)).rows[0]!.n).toBe(1);
    const r2 = await handleRawMessage(db, Buffer.from(RAW), META, ctx);
    expect(r2).toEqual({ ok: true, verdict: { verdict: 'duplicate' } });
    expect((await db.query(`SELECT raw_object_key FROM inbound_mail`)).rows[0]!.raw_object_key).toMatch(/^support-raw\//);
  });

  it('без хранилища: письмо всё равно принято, вложение — пометка «не сохранено»', async () => {
    const r = await handleRawMessage(db, Buffer.from(RAW), META, { settings: S, ownAddresses: [], store: null });
    expect(r).toMatchObject({ ok: true, verdict: { verdict: 'accepted' } });
    const m = await db.query(`SELECT body_text FROM support_messages`);
    expect(String(m.rows[0]!.body_text)).toContain('не сохранено: хранилище не настроено');
  });
});
