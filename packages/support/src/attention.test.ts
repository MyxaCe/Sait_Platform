import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SUPPORT_SETTINGS, type SupportSettings } from './settings';
import { assignTicket, changeTicketStatus, operatorReply, postClientChatMessage, type Actor } from './tickets';
import { countAwaitingOperator, listClientTickets, listQueue, queueStats } from './queries';
import { createTestDb, seedOperator, seedUser, type TestDb } from './testing/pg';

const ALWAYS: SupportSettings = {
  ...DEFAULT_SUPPORT_SETTINGS,
  hours: { ...DEFAULT_SUPPORT_SETTINGS.hours, alwaysOpen: true },
};

let db: TestDb;
let op: Actor;

beforeEach(async () => {
  db = await createTestDb();
  op = { operatorId: await seedOperator(db, 'support_operator', 'sup1'), role: 'support_operator', displayName: 'Ольга' };
});
afterEach(async () => db.close());

async function ticket(subject: string, userId?: string): Promise<{ id: string; userId: string }> {
  const uid = userId ?? (await seedUser(db));
  const r = await postClientChatMessage(db, ALWAYS, { userId: uid, body: subject });
  if (!r.ok) throw new Error('тикет не создан');
  return { id: r.ticketId, userId: uid };
}

async function setTimes(id: string, createdAt: string, lastClientAt: string | null, dueAt?: string) {
  await db.query(
    `UPDATE support_tickets SET created_at = $2, last_client_message_at = $3,
            first_response_due_at = COALESCE($4::timestamptz, first_response_due_at) WHERE id = $1`,
    [id, createdAt, lastClientAt, dueAt ?? null],
  );
}

describe('порядок очереди: сначала новые', () => {
  it('по умолчанию — по последнему сообщению клиента, без него — по созданию', async () => {
    const old = await ticket('Старое, но клиент только что ответил');
    const mid = await ticket('Среднее');
    const fresh = await ticket('Свежее без сообщения клиента');
    await setTimes(old.id, '2026-11-01T10:00:00Z', '2026-11-19T12:00:00Z', '2026-11-01T11:00:00Z');
    await setTimes(mid.id, '2026-11-10T10:00:00Z', '2026-11-10T10:00:00Z', '2026-11-10T11:00:00Z');
    await setTimes(fresh.id, '2026-11-18T10:00:00Z', null, '2026-11-18T11:00:00Z');

    const list = await listQueue(db, op, { filter: 'awaiting' });
    expect(list.rows.map((r) => r.subject)).toEqual([
      'Старое, но клиент только что ответил',
      'Свежее без сообщения клиента',
      'Среднее',
    ]);

    const all = await listQueue(db, op, { filter: 'all' });
    expect(all.rows.map((r) => r.id)).toEqual([old.id, fresh.id, mid.id]);
  });

  it('переключатель «по SLA» сохраняет прежний порядок «что горит — сверху»', async () => {
    const a = await ticket('Срок позже');
    const b = await ticket('Срок раньше');
    await setTimes(a.id, '2026-11-01T10:00:00Z', '2026-11-19T10:00:00Z', '2026-11-19T12:00:00Z');
    await setTimes(b.id, '2026-11-02T10:00:00Z', '2026-11-02T10:00:00Z', '2026-11-02T11:00:00Z');
    const sla = await listQueue(db, op, { filter: 'awaiting', sort: 'sla' });
    expect(sla.rows.map((r) => r.id)).toEqual([b.id, a.id]);
    const newest = await listQueue(db, op, { filter: 'awaiting', sort: 'newest' });
    expect(newest.rows.map((r) => r.id)).toEqual([a.id, b.id]);
  });

  it('обращения клиента в карточке — тоже сначала новые', async () => {
    const userId = await seedUser(db);
    const first = await ticket('Первое', userId);
    await db.query(`UPDATE support_tickets SET status = 'closed' WHERE id = $1`, [first.id]);
    const second = await ticket('Второе', userId);
    await setTimes(first.id, '2026-11-01T10:00:00Z', '2026-11-19T09:00:00Z');
    await setTimes(second.id, '2026-11-05T10:00:00Z', '2026-11-05T10:00:00Z');
    const rows = await listClientTickets(db, userId);
    expect(rows.map((r) => r.id)).toEqual([first.id, second.id]);
  });
});

describe('счётчик «требует внимания» = ждут ответа оператора (new | open)', () => {
  it('считает new и open; ответ оператора убирает, ответ клиента возвращает', async () => {
    const a = await ticket('Новое');
    const b = await ticket('Отвечено');
    const c = await ticket('Решено');
    expect(await countAwaitingOperator(db, op)).toBe(3);

    await operatorReply(db, ALWAYS, op, { ticketId: b.id, body: 'Ответ' });
    expect(await countAwaitingOperator(db, op)).toBe(2);

    await changeTicketStatus(db, op, { ticketId: c.id, to: 'resolved', reason: 'готово' });
    expect(await countAwaitingOperator(db, op)).toBe(1);

    await postClientChatMessage(db, ALWAYS, { userId: b.userId, body: 'Ещё вопрос' });
    expect(await countAwaitingOperator(db, op)).toBe(2);

    await db.query(`UPDATE support_tickets SET status = 'spam' WHERE id = $1`, [a.id]);
    expect(await countAwaitingOperator(db, op)).toBe(1);

    const stats = await queueStats(db, op);
    expect(stats.awaiting).toBe(await countAwaitingOperator(db, op));
  });

  it('finance_operator — только назначенные ему; роль без доступа — ноль', async () => {
    const fin: Actor = { operatorId: await seedOperator(db, 'finance_operator', 'fin1'), role: 'finance_operator', displayName: 'Фин' };
    const a = await ticket('В финансы');
    await ticket('Не его');
    expect(await countAwaitingOperator(db, fin)).toBe(0);
    await assignTicket(db, op, { ticketId: a.id, assigneeId: fin.operatorId });
    expect(await countAwaitingOperator(db, fin)).toBe(1);
    expect(await countAwaitingOperator(db, op)).toBe(2);
    const stranger = { operatorId: fin.operatorId, role: 'nobody', displayName: 'x' } as unknown as Actor;
    expect(await countAwaitingOperator(db, stranger)).toBe(0);
  });
});
