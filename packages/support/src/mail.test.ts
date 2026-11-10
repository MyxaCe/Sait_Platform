import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { processInboundMail, type InboundMail } from './inbound';
import { backoffMs, claimDueMail, markMailFailed, markMailSent, MAX_ATTEMPTS, requeueMail } from './outbound';
import { DEFAULT_SUPPORT_SETTINGS, type SupportSettings } from './settings';
import { changeTicketStatus, operatorReply, type Actor } from './tickets';
import { createTestDb, seedOperator, type TestDb } from './testing/pg';

/**
 * Почтовый канал: привязка входящего (новое / ответ / дубль / метка в теме /
 * автоответчик / блок-лист) и очередь исходящих (успех, сбой с повтором,
 * исчерпание попыток, истёкшие, стирание секретного тела).
 */

const S: SupportSettings = { ...DEFAULT_SUPPORT_SETTINGS, hours: { ...DEFAULT_SUPPORT_SETTINGS.hours, alwaysOpen: true } };
const OWN = ['support@wholesalefy.com'];
let db: TestDb;
let op: Actor;

beforeEach(async () => {
  db = await createTestDb();
  op = { operatorId: await seedOperator(db, 'support_operator'), role: 'support_operator', displayName: 'Ольга' };
});
afterEach(async () => db.close());

function mail(over: Partial<InboundMail> = {}): InboundMail {
  return {
    messageId: `<${Math.random().toString(36).slice(2)}@client.example>`,
    inReplyTo: null,
    references: [],
    from: { address: 'Guest@Client.Example', name: 'Гость Гостев' },
    to: OWN,
    subject: 'Не приходит код',
    text: 'Здравствуйте, не приходит код подтверждения.',
    date: new Date(),
    mailbox: 'INBOX',
    ...over,
  };
}

describe('входящее письмо', () => {
  it('новое письмо → тикет email/email, сообщение с Message-ID, подтверждение в очереди с In-Reply-To', async () => {
    const m = mail();
    const v = await processInboundMail(db, m, { settings: S, ownAddresses: OWN });
    expect(v).toMatchObject({ verdict: 'accepted', created: true });
    const t = await db.query(`SELECT origin_channel, reply_channel, contact_email, contact_name, locale, status FROM support_tickets`);
    expect(t.rows[0]).toEqual({
      origin_channel: 'email',
      reply_channel: 'email',
      contact_email: 'guest@client.example',
      contact_name: 'Гость Гостев',
      locale: 'ru',
      status: 'new',
    });
    const o = await db.query(`SELECT purpose, to_address, subject, in_reply_to FROM outbound_mail`);
    expect(o.rows).toHaveLength(1);
    expect(o.rows[0]).toMatchObject({ purpose: 'support_ack', to_address: 'guest@client.example', in_reply_to: m.messageId });
    expect(String(o.rows[0]!.subject)).toMatch(/^Re: Не приходит код \[#\d+\]$/);
    expect((await db.query(`SELECT verdict FROM inbound_mail`)).rows[0]!.verdict).toBe('accepted');
  });

  it('то же письмо второй раз (тот же Message-ID) — дубль, ничего не создано', async () => {
    const m = mail();
    await processInboundMail(db, m, { settings: S, ownAddresses: OWN });
    expect(await processInboundMail(db, m, { settings: S, ownAddresses: OWN })).toEqual({ verdict: 'duplicate' });
    expect((await db.query(`SELECT count(*)::int AS n FROM support_messages`)).rows[0]!.n).toBe(1);
  });

  it('ответ клиента на письмо оператора (In-Reply-To = наш Message-ID) → тот же тикет, статус open, цитата отрезана', async () => {
    const first = await processInboundMail(db, mail(), { settings: S, ownAddresses: OWN });
    if (first.verdict !== 'accepted') throw new Error();
    await operatorReply(db, S, op, { ticketId: first.ticketId, body: 'Проверьте папку «Спам».' });
    const claimed = await claimDueMail(db, { limit: 10, domain: 'wholesalefy.com' });
    const reply = claimed.find((c) => c.purpose === 'support_reply')!;
    expect(reply.inReplyTo).toBeTruthy();
    expect(reply.subject).toMatch(/\[#\d+\]/);
    await markMailSent(db, reply.id, reply.purpose, '250 OK');

    const v = await processInboundMail(
      db,
      mail({
        inReplyTo: reply.rfcMessageId,
        references: [reply.rfcMessageId],
        subject: `Re: ${reply.subject}`,
        text: 'Нашёл, спасибо!\n\nOn Tue, 10 Nov 2026 at 12:00, Support <support@wholesalefy.com> wrote:\n> Проверьте папку «Спам».',
      }),
      { settings: S, ownAddresses: OWN },
    );
    expect(v).toMatchObject({ verdict: 'accepted', created: false, ticketId: first.ticketId });
    const msgs = await db.query(`SELECT body_text FROM support_messages WHERE author_kind = 'client' ORDER BY created_at`);
    expect(msgs.rows.map((x) => x.body_text)).toEqual(['Здравствуйте, не приходит код подтверждения.', 'Нашёл, спасибо!']);
    expect((await db.query(`SELECT status FROM support_tickets`)).rows[0]!.status).toBe('open');
  });

  it('метка [#номер] в теме привязывает ТОЛЬКО письмо от контакта тикета; чужой адрес — новый тикет', async () => {
    const first = await processInboundMail(db, mail(), { settings: S, ownAddresses: OWN });
    if (first.verdict !== 'accepted') throw new Error();
    const same = await processInboundMail(db, mail({ subject: `Ещё вопрос [#${first.number}]` }), { settings: S, ownAddresses: OWN });
    expect(same).toMatchObject({ verdict: 'accepted', created: false, ticketId: first.ticketId });
    const stranger = await processInboundMail(
      db,
      mail({ from: { address: 'attacker@evil.example', name: null }, subject: `Подмена [#${first.number}]` }),
      { settings: S, ownAddresses: OWN },
    );
    expect(stranger).toMatchObject({ verdict: 'accepted', created: true });
  });

  it('письмо в закрытый тикет — новый тикет', async () => {
    const first = await processInboundMail(db, mail(), { settings: S, ownAddresses: OWN });
    if (first.verdict !== 'accepted') throw new Error();
    await changeTicketStatus(db, op, { ticketId: first.ticketId, to: 'resolved' });
    await changeTicketStatus(db, op, { ticketId: first.ticketId, to: 'closed' });
    const v = await processInboundMail(db, mail({ subject: `Re: [#${first.number}]` }), { settings: S, ownAddresses: OWN });
    expect(v).toMatchObject({ verdict: 'accepted', created: true });
  });

  it('автоответчик (Auto-Submitted), своё письмо, блок-лист, лимит с адреса — без тикета и без автоответа', async () => {
    expect(await processInboundMail(db, mail({ autoSubmitted: 'auto-replied' }), { settings: S, ownAddresses: OWN })).toMatchObject({
      verdict: 'loop',
    });
    expect(
      await processInboundMail(db, mail({ from: { address: 'support@wholesalefy.com', name: null } }), { settings: S, ownAddresses: OWN }),
    ).toMatchObject({ verdict: 'own' });
    expect(
      await processInboundMail(db, mail({ from: { address: 'MAILER-DAEMON@x.example', name: null } }), { settings: S, ownAddresses: OWN }),
    ).toMatchObject({ verdict: 'loop' });
    await db.query(`INSERT INTO support_blocklist (kind, value, reason) VALUES ('domain', 'spam.example', 'спам')`);
    expect(
      await processInboundMail(db, mail({ from: { address: 'x@spam.example', name: null } }), { settings: S, ownAddresses: OWN }),
    ).toMatchObject({ verdict: 'blocked' });
    expect((await db.query(`SELECT count(*)::int AS n FROM support_tickets`)).rows[0]!.n).toBe(0);
    expect((await db.query(`SELECT count(*)::int AS n FROM outbound_mail`)).rows[0]!.n).toBe(0);

    const tight = { ...S, limits: { ...S.limits, emailsPerSenderPerHour: 1 } };
    await processInboundMail(db, mail(), { settings: tight, ownAddresses: OWN });
    expect(await processInboundMail(db, mail(), { settings: tight, ownAddresses: OWN })).toMatchObject({ verdict: 'spam' });
  });

  it('plus-адрес support+<token>@ привязывает к тикету', async () => {
    const first = await processInboundMail(db, mail(), { settings: S, ownAddresses: OWN });
    if (first.verdict !== 'accepted') throw new Error();
    const tok = (await db.query(`SELECT email_thread_token FROM support_tickets`)).rows[0]!.email_thread_token;
    const v = await processInboundMail(
      db,
      mail({ to: [`support+${tok}@wholesalefy.com`], subject: 'без метки', from: { address: 'other@client.example', name: null } }),
      { settings: S, ownAddresses: OWN },
    );
    expect(v).toMatchObject({ verdict: 'accepted', created: false, ticketId: first.ticketId });
  });

  it('автоответ выключен в настройках — подтверждение не ставится', async () => {
    const off = { ...S, autoReply: { enabled: false } };
    await processInboundMail(db, mail(), { settings: off, ownAddresses: OWN });
    expect((await db.query(`SELECT count(*)::int AS n FROM outbound_mail`)).rows[0]!.n).toBe(0);
  });
});

describe('очередь исходящих', () => {
  async function queueOne(purpose = 'support_reply', expires: Date | null = null) {
    const r = await db.query(
      `INSERT INTO outbound_mail (purpose, to_address, subject, body_text, expires_at) VALUES ($1, 'c@client.example', 'S', 'B', $2) RETURNING id`,
      [purpose, expires],
    );
    return String(r.rows[0]!.id);
  }

  it('забор: Message-ID назначается один раз и не меняется при повторе; успех → sent', async () => {
    const id = await queueOne();
    const [a] = await claimDueMail(db, { limit: 5, domain: 'wholesalefy.com' });
    expect(a).toMatchObject({ id, attempts: 1, rfcMessageId: `<${id}@wholesalefy.com>` });
    expect(await claimDueMail(db, { limit: 5, domain: 'wholesalefy.com' })).toEqual([]);
    expect(await markMailFailed(db, a!, 'ECONNRESET')).toBe('retry');
    const row = (await db.query(`SELECT status, next_attempt_at, last_error FROM outbound_mail`)).rows[0]!;
    expect(row).toMatchObject({ status: 'queued', last_error: 'ECONNRESET' });
    // Ещё рано — не забирается; после паузы — тот же Message-ID.
    expect(await claimDueMail(db, { limit: 5, domain: 'x' })).toEqual([]);
    const later = new Date(Date.now() + backoffMs(1) + 1000);
    const [b] = await claimDueMail(db, { limit: 5, domain: 'other-domain', now: later });
    expect(b).toMatchObject({ attempts: 2, rfcMessageId: `<${id}@wholesalefy.com>` });
    await markMailSent(db, b!.id, b!.purpose, '250 2.0.0 OK');
    expect((await db.query(`SELECT status, provider_response, body_text FROM outbound_mail`)).rows[0]).toEqual({
      status: 'sent',
      provider_response: '250 2.0.0 OK',
      body_text: 'B',
    });
  });

  it('исчерпание попыток или постоянная ошибка → failed; оператор может повторить вручную', async () => {
    await queueOne();
    let mailRow = (await claimDueMail(db, { limit: 1, domain: 'd' }))[0]!;
    expect(await markMailFailed(db, { ...mailRow, attempts: MAX_ATTEMPTS }, '421 try later')).toBe('failed');
    expect(await requeueMail(db, mailRow.id)).toBe(true);
    mailRow = (await claimDueMail(db, { limit: 1, domain: 'd' }))[0]!;
    expect(await markMailFailed(db, mailRow, '550 no such user', { permanent: true })).toBe('failed');
    expect((await db.query(`SELECT status FROM outbound_mail`)).rows[0]!.status).toBe('failed');
  });

  it('секретное тело (сброс пароля) стирается после отправки; истёкшее — отменяется, не уходя', async () => {
    const reset = await queueOne('password_reset');
    const [m] = await claimDueMail(db, { limit: 1, domain: 'd' });
    await markMailSent(db, m!.id, m!.purpose, '250');
    expect((await db.query(`SELECT body_text FROM outbound_mail WHERE id = $1`, [reset])).rows[0]!.body_text).toBeNull();
    const old = await queueOne('support_ack', new Date(Date.now() - 1000));
    expect(await claimDueMail(db, { limit: 5, domain: 'd' })).toEqual([]);
    expect((await db.query(`SELECT status FROM outbound_mail WHERE id = $1`, [old])).rows[0]!.status).toBe('cancelled');
  });

  it('зависшее «sending» (воркер упал) возвращается в очередь через 10 минут', async () => {
    await queueOne();
    await claimDueMail(db, { limit: 1, domain: 'd' });
    expect(await claimDueMail(db, { limit: 1, domain: 'd' })).toEqual([]);
    const later = new Date(Date.now() + 11 * 60_000);
    expect(await claimDueMail(db, { limit: 1, domain: 'd', now: later })).toHaveLength(1);
  });

  it('пауза повтора растёт и упирается в час', () => {
    expect([1, 2, 3, 4, 10].map(backoffMs)).toEqual([60_000, 120_000, 240_000, 480_000, 3_600_000]);
  });
});
