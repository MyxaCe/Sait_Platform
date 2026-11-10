import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SUPPORT_SETTINGS, type SupportSettings } from './settings';
import {
  addInternalNote,
  assignTicket,
  autoCloseResolved,
  changeTicketStatus,
  linkTicketToClient,
  markClientRead,
  operatorReply,
  postClientChatMessage,
  rateTicket,
  recordContextView,
  type Actor,
} from './tickets';
import { countClientUnread, getClientChat, getTicketForOperator, listQueue, queueStats } from './queries';
import { createTestDb, seedOperator, seedUser, type TestDb } from './testing/pg';

/**
 * Жизненный цикл тикета на настоящей схеме (PGlite + все миграции):
 * чат клиента → ответ оператора → ответ клиента → решено → оценка →
 * автозакрытие; журнал без текста; неизменяемость сообщений.
 */

const ALWAYS: SupportSettings = {
  ...DEFAULT_SUPPORT_SETTINGS,
  hours: { ...DEFAULT_SUPPORT_SETTINGS.hours, alwaysOpen: true },
};

let db: TestDb;
let userId: string;
let op: Actor;

beforeEach(async () => {
  db = await createTestDb();
  userId = await seedUser(db, { email: 'anna@client.test', name: 'Анна Клиентова' });
  op = { operatorId: await seedOperator(db, 'support_operator', 'sup1'), role: 'support_operator', displayName: 'Ольга' };
});
afterEach(async () => db.close());

async function journal(action?: string) {
  const r = await db.query(
    `SELECT action, subject_kind, subject_id, payload, operator_id FROM admin_action_journal ${action ? 'WHERE action = $1' : ''} ORDER BY seq`,
    action ? [action] : [],
  );
  return r.rows;
}

describe('жизненный цикл тикета', () => {
  it('чат: первое сообщение создаёт тикет new с номером и SLA; второе дописывает в него же', async () => {
    const a = await postClientChatMessage(db, ALWAYS, { userId, body: 'Не могу вывести средства' });
    expect(a).toMatchObject({ ok: true, created: true });
    if (!a.ok) throw new Error();
    expect(a.number).toBeGreaterThanOrEqual(1001);
    const b = await postClientChatMessage(db, ALWAYS, { userId, body: 'Скрин приложу' });
    expect(b).toMatchObject({ ok: true, created: false, ticketId: a.ticketId });
    const t = await db.query(`SELECT status, origin_channel, reply_channel, first_response_due_at, subject FROM support_tickets`);
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]).toMatchObject({ status: 'new', origin_channel: 'chat', reply_channel: 'chat', subject: 'Не могу вывести средства' });
    expect(t.rows[0]!.first_response_due_at).not.toBeNull();
  });

  it('ответ оператора: waiting_client, первый ответ, назначение на себя, уведомление клиенту, журнал без текста', async () => {
    const a = await postClientChatMessage(db, ALWAYS, { userId, body: 'Вопрос' });
    if (!a.ok) throw new Error();
    const r = await operatorReply(db, ALWAYS, op, { ticketId: a.ticketId, body: 'Секретный ответ про счёт', templateKey: 'kyc.docs' });
    expect(r).toMatchObject({ ok: true, mailQueued: false });
    const t = await db.query(`SELECT status, first_responded_at, assignee_operator_id FROM support_tickets`);
    expect(t.rows[0]).toMatchObject({ status: 'waiting_client', assignee_operator_id: op.operatorId });
    expect(t.rows[0]!.first_responded_at).not.toBeNull();
    const n = await db.query(`SELECT type, params FROM notifications WHERE user_id = $1`, [userId]);
    expect(n.rows).toEqual([{ type: 'supportReply', params: { number: a.number } }]);
    const j = await journal('support.reply.sent');
    expect(j).toHaveLength(1);
    expect(j[0]!.subject_kind).toBe('support_ticket');
    const payload = j[0]!.payload as Record<string, unknown>;
    expect(payload).toMatchObject({ ticketNumber: a.number, channel: 'chat', templateKey: 'kyc.docs', statusTo: 'waiting_client' });
    expect(payload.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(j)).not.toContain('Секретный ответ');
  });

  it('клиент отвечает → open; решено → уведомление; оценка один раз; повторная — alreadyRated', async () => {
    const a = await postClientChatMessage(db, ALWAYS, { userId, body: 'Вопрос' });
    if (!a.ok) throw new Error();
    await operatorReply(db, ALWAYS, op, { ticketId: a.ticketId, body: 'Ответ' });
    await postClientChatMessage(db, ALWAYS, { userId, body: 'Спасибо, но ещё вопрос' });
    expect((await db.query(`SELECT status FROM support_tickets`)).rows[0]!.status).toBe('open');

    expect(await rateTicket(db, { userId, ticketId: a.ticketId, score: 5 })).toEqual({ ok: false, reason: 'invalidTransition' });
    expect(await changeTicketStatus(db, op, { ticketId: a.ticketId, to: 'resolved' })).toEqual({ ok: true });
    const n = await db.query(`SELECT type FROM notifications WHERE user_id = $1 ORDER BY created_at`, [userId]);
    expect(n.rows.map((x) => x.type)).toContain('supportResolved');
    expect(await rateTicket(db, { userId, ticketId: a.ticketId, score: 9 })).toEqual({ ok: false, reason: 'invalidScore' });
    expect(await rateTicket(db, { userId, ticketId: a.ticketId, score: 5, comment: 'быстро' })).toEqual({ ok: true });
    expect(await rateTicket(db, { userId, ticketId: a.ticketId, score: 1 })).toEqual({ ok: false, reason: 'alreadyRated' });
    const other = await seedUser(db);
    expect(await rateTicket(db, { userId: other, ticketId: a.ticketId, score: 1 })).toEqual({ ok: false, reason: 'notFound' });
  });

  it('решённый + сообщение клиента → переоткрыт (open, resolved_at сброшен)', async () => {
    const a = await postClientChatMessage(db, ALWAYS, { userId, body: 'Вопрос' });
    if (!a.ok) throw new Error();
    await changeTicketStatus(db, op, { ticketId: a.ticketId, to: 'resolved' });
    const b = await postClientChatMessage(db, ALWAYS, { userId, body: 'Снова не работает' });
    expect(b).toMatchObject({ ok: true, created: false, ticketId: a.ticketId });
    const t = await db.query(`SELECT status, resolved_at FROM support_tickets`);
    expect(t.rows[0]).toMatchObject({ status: 'open', resolved_at: null });
  });

  it('закрытый тикет не дописывается — новое сообщение создаёт новый тикет', async () => {
    const a = await postClientChatMessage(db, ALWAYS, { userId, body: 'Вопрос' });
    if (!a.ok) throw new Error();
    await changeTicketStatus(db, op, { ticketId: a.ticketId, to: 'resolved' });
    await changeTicketStatus(db, op, { ticketId: a.ticketId, to: 'closed' });
    const b = await postClientChatMessage(db, ALWAYS, { userId, body: 'Новый вопрос' });
    expect(b).toMatchObject({ ok: true, created: true });
    if (b.ok) expect(b.ticketId).not.toBe(a.ticketId);
  });

  it('недопустимый переход и спам без основания — отказ; спам с основанием — журнал и блок отправителя', async () => {
    const a = await postClientChatMessage(db, ALWAYS, { userId, body: 'Вопрос' });
    if (!a.ok) throw new Error();
    expect(await changeTicketStatus(db, op, { ticketId: a.ticketId, to: 'closed' })).toEqual({ ok: false, reason: 'invalidTransition' });
    expect(await changeTicketStatus(db, op, { ticketId: a.ticketId, to: 'spam' })).toEqual({ ok: false, reason: 'reasonRequired' });
    expect(await changeTicketStatus(db, op, { ticketId: a.ticketId, to: 'spam', reason: 'реклама', blockSender: true })).toEqual({ ok: true });
    expect((await journal('support.ticket.marked_spam'))[0]!.payload).toMatchObject({ basis: 'реклама', from: 'new' });
    expect((await db.query(`SELECT kind, value FROM support_blocklist`)).rows).toEqual([{ kind: 'email', value: 'anna@client.test' }]);
    // Ответить в спам нельзя.
    expect(await operatorReply(db, ALWAYS, op, { ticketId: a.ticketId, body: 'x' })).toEqual({ ok: false, reason: 'invalidTransition' });
  });

  it('сообщения неизменяемы базой: UPDATE и DELETE падают', async () => {
    await postClientChatMessage(db, ALWAYS, { userId, body: 'Вопрос' });
    await expect(db.query(`UPDATE support_messages SET body_text = 'подмена'`)).rejects.toThrow(/неизменяемы/);
    await expect(db.query(`DELETE FROM support_messages`)).rejects.toThrow(/неизменяемы/);
  });

  it('внутренняя заметка: видна оператору, НЕ выбирается для клиента; журнал с sha256', async () => {
    const a = await postClientChatMessage(db, ALWAYS, { userId, body: 'Вопрос' });
    if (!a.ok) throw new Error();
    await addInternalNote(db, op, { ticketId: a.ticketId, body: 'Клиент под AML-проверкой, не говорить' });
    await operatorReply(db, ALWAYS, op, { ticketId: a.ticketId, body: 'Проверяем' });
    const forOp = await getTicketForOperator(db, op, String(a.number));
    expect(forOp?.messages.map((m) => m.visibility)).toEqual(['public', 'internal', 'public']);
    const chat = await getClientChat(db, userId);
    expect(chat.messages.map((m) => m.body)).toEqual(['Вопрос', 'Проверяем']);
    expect(JSON.stringify(chat)).not.toContain('AML');
    expect((await journal('support.note.added'))).toHaveLength(1);
  });

  it('непрочитанное: ответ оператора +1, открыл переписку — 0', async () => {
    const a = await postClientChatMessage(db, ALWAYS, { userId, body: 'Вопрос' });
    if (!a.ok) throw new Error();
    await operatorReply(db, ALWAYS, op, { ticketId: a.ticketId, body: 'Ответ' });
    expect(await countClientUnread(db, userId)).toBe(1);
    await markClientRead(db, userId, a.ticketId);
    expect(await countClientUnread(db, userId)).toBe(0);
  });

  it('вне рабочих часов — автоответ из настроек; в часы — без автоответа', async () => {
    const closed: SupportSettings = {
      ...DEFAULT_SUPPORT_SETTINGS,
      hours: { ...DEFAULT_SUPPORT_SETTINGS.hours, timezone: 'UTC', alwaysOpen: false },
    };
    // Воскресенье — выходной по умолчанию.
    await postClientChatMessage(db, closed, { userId, body: 'Ночной вопрос', now: new Date('2026-11-15T03:00:00Z') });
    const chat = await getClientChat(db, userId);
    expect(chat.messages.map((m) => m.authorKind)).toEqual(['client', 'autoreply']);
    expect(chat.messages[1]!.body).toContain('нерабочее время');
    expect(chat.messages[1]!.body).toContain('пн–пт 09:00–21:00');
  });

  it('канал чата выключен — отказ; лимит частоты — rateLimited', async () => {
    const off: SupportSettings = { ...ALWAYS, channels: { ...ALWAYS.channels, chat: false } };
    expect(await postClientChatMessage(db, off, { userId, body: 'x' })).toEqual({ ok: false, reason: 'channelDisabled' });
    const tight: SupportSettings = { ...ALWAYS, limits: { ...ALWAYS.limits, chatMessagesPerMinute: 2 } };
    await postClientChatMessage(db, tight, { userId, body: '1' });
    await postClientChatMessage(db, tight, { userId, body: '2' });
    expect(await postClientChatMessage(db, tight, { userId, body: '3' })).toEqual({ ok: false, reason: 'rateLimited' });
  });

  it('назначение: new → open, журнал от/кому; системную учётку назначить нельзя', async () => {
    const a = await postClientChatMessage(db, ALWAYS, { userId, body: 'Вопрос' });
    if (!a.ok) throw new Error();
    const other = await seedOperator(db, 'operator', 'op2');
    expect(await assignTicket(db, op, { ticketId: a.ticketId, assigneeId: other })).toEqual({ ok: true });
    expect((await db.query(`SELECT status FROM support_tickets`)).rows[0]!.status).toBe('open');
    expect((await journal('support.ticket.assigned'))[0]!.payload).toMatchObject({ from: null, to: other });
    expect(await assignTicket(db, op, { ticketId: a.ticketId, assigneeId: '00000000-0000-4000-8000-00000000c0b4' })).toEqual({
      ok: false,
      reason: 'invalidAssignee',
    });
  });

  it('автозакрытие: решённый старше N дней → closed от системного автора', async () => {
    const a = await postClientChatMessage(db, ALWAYS, { userId, body: 'Вопрос' });
    if (!a.ok) throw new Error();
    await changeTicketStatus(db, op, { ticketId: a.ticketId, to: 'resolved', now: new Date(Date.now() - 10 * 86_400_000) });
    expect(await autoCloseResolved(db, ALWAYS)).toBe(1);
    expect((await db.query(`SELECT status FROM support_tickets`)).rows[0]!.status).toBe('closed');
    const j = await journal('support.ticket.auto_closed');
    expect(j[0]!.operator_id).toBe('00000000-0000-4000-8000-00000000c0b4');
    expect(await autoCloseResolved(db, ALWAYS)).toBe(0);
  });

  it('склейка гостя с клиентом — только с основанием; просмотр контекста журналируется не чаще раза в 30 мин', async () => {
    const r = await db.query(
      `INSERT INTO support_tickets (contact_email, origin_channel, reply_channel, subject) VALUES ('anna@client.test','email','email','Вопрос') RETURNING id`,
    );
    const id = String(r.rows[0]!.id);
    expect(await linkTicketToClient(db, op, { ticketId: id, userId, reason: ' ' })).toEqual({ ok: false, reason: 'reasonRequired' });
    expect(await linkTicketToClient(db, op, { ticketId: id, userId, reason: 'тот же email' })).toEqual({ ok: true });
    expect(await recordContextView(db, op, id, userId)).toBe(true);
    expect(await recordContextView(db, op, id, userId)).toBe(false);
  });

  it('очередь и счётчики: ждут ответа, просрочено по SLA', async () => {
    const a = await postClientChatMessage(db, ALWAYS, { userId, body: 'Вопрос', now: new Date(Date.now() - 3 * 3_600_000) });
    if (!a.ok) throw new Error();
    const stats = await queueStats(db, op);
    expect(stats).toMatchObject({ awaiting: 1, overdue: 1, unassigned: 1 });
    const q = await listQueue(db, op, { filter: 'awaiting' });
    expect(q.total).toBe(1);
    expect(q.rows[0]).toMatchObject({ number: a.number, overdue: true, clientName: 'Анна Клиентова' });
    expect((await listQueue(db, op, { filter: 'all', q: `#${a.number}` })).total).toBe(1);
    expect((await listQueue(db, op, { filter: 'all', q: 'нет-такого' })).total).toBe(0);
  });
});
