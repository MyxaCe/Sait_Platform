import { randomUUID } from 'node:crypto';
import { appendJournalWithinTx, inTransaction, rollback, type PoolLike, type Queryable } from '@broker/money';
import { addBusinessMinutes, isWithinHours, slaMinutesFor } from './hours';
import {
  SUPPORT_ACTIONS,
  SUPPORT_SYSTEM_OPERATOR,
  canTransition,
  supportAccess,
  type Channel,
  type ReplyChannel,
  type SupportRole,
  type TicketStatus,
} from './model';
import { describeHours, type SupportSettings } from './settings';
import { enqueueMail } from './outbound';
import {
  firstNameOf,
  isPlausibleEmail,
  normalizeEmail,
  renderTemplate,
  replySubject,
  sanitizeBody,
  sanitizeSubject,
  sha256,
  subjectWithTag,
} from './text';

/**
 * Жизненный цикл тикета (дизайн §3.1–3.4). Каждое действие оператора — одна
 * транзакция: состояние + сообщение + (письмо в очередь | уведомление
 * клиенту) + запись журнала. Текст ответа в журнал не кладётся — id и sha256.
 */

export interface Actor {
  operatorId: string;
  role: SupportRole;
  displayName?: string;
}

export type SupportFailure =
  | 'notFound'
  | 'forbidden'
  | 'invalidTransition'
  | 'emptyBody'
  | 'reasonRequired'
  | 'channelDisabled'
  | 'emailChannelDisabled'
  | 'rateLimited'
  | 'invalidAssignee'
  | 'invalidClient'
  | 'invalidEmail'
  | 'alreadyRated'
  | 'invalidScore';

export type Outcome<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; reason: SupportFailure };

export interface AttachmentInput {
  objectKey: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
}

export interface TicketRow {
  id: string;
  number: number;
  user_id: string | null;
  contact_email: string;
  contact_name: string | null;
  locale: 'ru' | 'en';
  origin_channel: Channel;
  reply_channel: ReplyChannel;
  subject: string;
  status: TicketStatus;
  assignee_operator_id: string | null;
  email_thread_token: string;
  first_responded_at: Date | null;
}

const TICKET_COLS = `id, number, user_id, contact_email, contact_name, locale, origin_channel, reply_channel,
  subject, status, assignee_operator_id, email_thread_token, first_responded_at`;

function toTicket(r: Record<string, unknown>): TicketRow {
  return { ...(r as unknown as TicketRow), number: Number(r.number) };
}

async function lockTicket(tx: Queryable, ticketId: string): Promise<TicketRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(ticketId)) return null;
  const r = await tx.query(`SELECT ${TICKET_COLS} FROM support_tickets WHERE id = $1 FOR UPDATE`, [ticketId]);
  return r.rows[0] ? toTicket(r.rows[0]) : null;
}

/** Может ли актор работать с этим тикетом. Fail-closed. */
export function canActOn(actor: Actor, t: { assignee_operator_id: string | null }): boolean {
  if (supportAccess.seesWholeQueue(actor.role)) return true;
  return actor.role === 'finance_operator' && t.assignee_operator_id === actor.operatorId;
}

async function journal(
  tx: Queryable,
  operatorId: string,
  action: string,
  ticketId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await appendJournalWithinTx({ operatorId, action, subjectKind: 'support_ticket', subjectId: ticketId, payload }, tx);
  await tx.query(
    `UPDATE support_tickets SET last_journal_seq = (SELECT max(seq) FROM admin_action_journal) WHERE id = $1`,
    [ticketId],
  );
}

async function notifyClient(tx: Queryable, userId: string | null, type: string, params: Record<string, unknown>) {
  if (!userId) return;
  await tx.query(`INSERT INTO notifications (id, user_id, type, params) VALUES ($1, $2, $3, $4)`, [
    randomUUID(),
    userId,
    type,
    JSON.stringify(params),
  ]);
}

async function insertMessage(
  tx: Queryable,
  m: {
    ticketId: string;
    authorKind: 'client' | 'operator' | 'system' | 'autoreply';
    authorUserId?: string | null;
    authorOperatorId?: string | null;
    visibility?: 'public' | 'internal';
    channel: Channel;
    body: string;
    templateKey?: string | null;
    emailMessageId?: string | null;
    emailInReplyTo?: string | null;
    createdAt?: Date;
  },
): Promise<string> {
  const r = await tx.query(
    `INSERT INTO support_messages (ticket_id, author_kind, author_user_id, author_operator_id, visibility, channel,
       body_text, template_key, email_message_id, email_in_reply_to, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11, now())) RETURNING id`,
    [
      m.ticketId,
      m.authorKind,
      m.authorUserId ?? null,
      m.authorOperatorId ?? null,
      m.visibility ?? 'public',
      m.channel,
      m.body,
      m.templateKey ?? null,
      m.emailMessageId ?? null,
      m.emailInReplyTo ?? null,
      m.createdAt ?? null,
    ],
  );
  return String(r.rows[0]!.id);
}

export async function insertAttachments(
  tx: Queryable,
  ticketId: string,
  messageId: string,
  files: readonly AttachmentInput[],
): Promise<void> {
  for (const f of files) {
    await tx.query(
      `INSERT INTO support_attachments (message_id, ticket_id, object_key, filename, mime, size_bytes, sha256)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [messageId, ticketId, f.objectKey, f.filename.slice(0, 200), f.mime, f.sizeBytes, f.sha256],
    );
  }
}

/* ─── Создание тикета ───────────────────────────────────────────────── */

export interface NewTicket {
  userId: string | null;
  contactEmail: string;
  contactName: string | null;
  locale: 'ru' | 'en';
  origin: Channel;
  replyChannel: ReplyChannel;
  subject: string;
  category?: string | null;
  body: string;
  sourceLeadId?: string | null;
  createdAt?: Date;
  emailMessageId?: string | null;
  emailInReplyTo?: string | null;
}

export interface CreatedTicket {
  ticketId: string;
  number: number;
  messageId: string;
  threadToken: string;
}

/**
 * Тикет + первое сообщение клиента, внутри транзакции вызывающего. Срок
 * первого ответа — в рабочих минутах календаря (SLA канала из настроек).
 * `sourceLeadId` уже занят → `null` (идемпотентность восстановления лидов).
 */
export async function createTicketTx(
  tx: Queryable,
  settings: SupportSettings,
  t: NewTicket,
): Promise<CreatedTicket | null> {
  const createdAt = t.createdAt ?? new Date();
  const due = addBusinessMinutes(settings, createdAt, slaMinutesFor(settings, t.origin));
  const r = await tx.query(
    `INSERT INTO support_tickets (user_id, contact_email, contact_name, locale, origin_channel, reply_channel,
       subject, category, source_lead_id, first_response_due_at, last_client_message_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $11)
     ON CONFLICT (source_lead_id) DO NOTHING
     RETURNING id, number, email_thread_token`,
    [
      t.userId,
      normalizeEmail(t.contactEmail),
      t.contactName,
      t.locale,
      t.origin,
      t.replyChannel,
      sanitizeSubject(t.subject) || '(без темы)',
      t.category ?? null,
      t.sourceLeadId ?? null,
      due,
      createdAt,
    ],
  );
  const row = r.rows[0];
  if (!row) return null;
  const ticketId = String(row.id);
  const messageId = await insertMessage(tx, {
    ticketId,
    authorKind: 'client',
    authorUserId: t.userId,
    channel: t.origin,
    body: sanitizeBody(t.body) || '(пусто)',
    emailMessageId: t.emailMessageId,
    emailInReplyTo: t.emailInReplyTo,
    createdAt,
  });
  return { ticketId, number: Number(row.number), messageId, threadToken: String(row.email_thread_token) };
}

/** Переменные шаблонов и автоответов. */
export function templateVars(
  settings: SupportSettings,
  t: { number: number; subject: string; contactName: string | null; locale: 'ru' | 'en' },
  operatorName?: string,
): Record<string, unknown> {
  return {
    client: { firstName: firstNameOf(t.contactName) || (t.locale === 'ru' ? 'клиент' : 'there'), name: t.contactName ?? '' },
    ticket: { number: t.number, subject: t.subject },
    operator: { name: operatorName ?? '' },
    hours: describeHours(settings, t.locale),
  };
}

/** Подтверждение получения письмом (гость формы/письма). */
export async function enqueueAckTx(
  tx: Queryable,
  settings: SupportSettings,
  c: CreatedTicket & { to: string; subject: string; contactName: string | null; locale: 'ru' | 'en'; inReplyTo?: string | null },
): Promise<void> {
  if (!settings.autoReply.enabled || !settings.channels.email) return;
  const texts = settings.texts[c.locale];
  const vars = templateVars(settings, { number: c.number, subject: c.subject, contactName: c.contactName, locale: c.locale });
  await enqueueMail(tx, {
    purpose: 'support_ack',
    ticketId: c.ticketId,
    to: c.to,
    subject: c.inReplyTo ? replySubject(c.subject, c.number) : subjectWithTag(c.subject, c.number),
    bodyText: `${renderTemplate(texts.autoReply, vars)}\n\n${renderTemplate(texts.signature, vars)}`,
    inReplyTo: c.inReplyTo ?? null,
    references: c.inReplyTo ? [c.inReplyTo] : [],
    // Подтверждение, ушедшее через трое суток, только путает.
    expiresAt: new Date(Date.now() + 72 * 3_600_000),
  });
}

/* ─── Форма витрины (гость) ─────────────────────────────────────────── */

export interface WebFormInput {
  name: string;
  email: string;
  subject: string;
  body: string;
  locale: 'ru' | 'en';
  category?: string | null;
  leadId?: string | null;
  createdAt?: Date;
}

/**
 * Гость с витрины → тикет `web_form`, ответ письмом. Вызывается ВНУТРИ
 * транзакции записи лида (форма контактов): лид, событие и тикет появляются
 * вместе или не появляются вовсе.
 */
export async function createWebFormTicketTx(
  tx: Queryable,
  settings: SupportSettings,
  input: WebFormInput,
  opts: { sendAck?: boolean } = {},
): Promise<Outcome<CreatedTicket>> {
  if (!isPlausibleEmail(input.email)) return { ok: false, reason: 'invalidEmail' };
  const body = sanitizeBody(input.body);
  if (!body) return { ok: false, reason: 'emptyBody' };
  const created = await createTicketTx(tx, settings, {
    userId: null,
    contactEmail: input.email,
    contactName: input.name.trim().slice(0, 120) || null,
    locale: input.locale,
    origin: 'web_form',
    replyChannel: 'email',
    subject: input.subject,
    category: input.category ?? null,
    body,
    sourceLeadId: input.leadId ?? null,
    createdAt: input.createdAt,
  });
  if (!created) return { ok: false, reason: 'notFound' };
  if (opts.sendAck !== false) {
    await enqueueAckTx(tx, settings, {
      ...created,
      to: input.email,
      subject: input.subject,
      contactName: input.name,
      locale: input.locale,
    });
  }
  return { ok: true, ...created };
}

/* ─── Чат кабинета ──────────────────────────────────────────────────── */

/** Тема чат-обращения: первая строка, не длиннее 60 символов (с «…»). */
export function chatSubject(body: string): string {
  const first = body.trim().split('\n')[0]!.trim();
  return first.length > 60 ? `${first.slice(0, 59).trimEnd()}…` : first;
}

export interface ChatPostInput {
  userId: string;
  body: string;
  category?: string | null;
  attachments?: readonly AttachmentInput[];
  now?: Date;
}

/**
 * Сообщение клиента из кабинета. Активный тикет клиента (не closed/spam)
 * дополняется; «решено» и «ждём клиента» переоткрываются; иначе — новый тикет
 * канала `chat`. Вне рабочих часов на новый/переоткрытый — автоответ из
 * настроек. Лимит частоты — по базе (переживает рестарт, общий для реплик).
 */
export async function postClientChatMessage(
  db: PoolLike,
  settings: SupportSettings,
  input: ChatPostInput,
): Promise<Outcome<{ ticketId: string; number: number; messageId: string; created: boolean }>> {
  if (!settings.channels.chat) return { ok: false, reason: 'channelDisabled' };
  const body = sanitizeBody(input.body);
  if (!body && !(input.attachments?.length ?? 0)) return { ok: false, reason: 'emptyBody' };
  const now = input.now ?? new Date();

  return inTransaction<Outcome<{ ticketId: string; number: number; messageId: string; created: boolean }>>(db, async (tx) => {
    const rate = await tx.query(
      `SELECT count(*)::int AS n FROM support_messages
        WHERE author_user_id = $1 AND author_kind = 'client' AND created_at > $2`,
      [input.userId, new Date(now.getTime() - 60_000)],
    );
    if (Number(rate.rows[0]?.n ?? 0) >= settings.limits.chatMessagesPerMinute) {
      return rollback({ ok: false as const, reason: 'rateLimited' as const });
    }
    const u = await tx.query(`SELECT email, full_name, locale FROM users WHERE id = $1`, [input.userId]);
    const user = u.rows[0];
    if (!user) return rollback({ ok: false as const, reason: 'invalidClient' as const });
    const locale = user.locale === 'en' ? 'en' : 'ru';

    const active = await tx.query(
      `SELECT ${TICKET_COLS} FROM support_tickets
        WHERE user_id = $1 AND status NOT IN ('closed', 'spam') AND reply_channel = 'chat'
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [input.userId],
    );
    let ticketId: string;
    let number: number;
    let messageId: string;
    let created = false;
    let reopened = false;
    const text = body || '📎';

    if (active.rows[0]) {
      const t = toTicket(active.rows[0]);
      ticketId = t.id;
      number = t.number;
      messageId = await insertMessage(tx, {
        ticketId,
        authorKind: 'client',
        authorUserId: input.userId,
        channel: 'chat',
        body: text,
        createdAt: now,
      });
      reopened = t.status === 'resolved';
      const nextStatus = t.status === 'waiting_client' || t.status === 'resolved' ? 'open' : t.status;
      await tx.query(
        `UPDATE support_tickets SET status = $2, last_client_message_at = $3, updated_at = $3,
           resolved_at = CASE WHEN $2 = 'open' THEN NULL ELSE resolved_at END
         WHERE id = $1`,
        [ticketId, nextStatus, now],
      );
    } else {
      const c = await createTicketTx(tx, settings, {
        userId: input.userId,
        contactEmail: String(user.email),
        contactName: String(user.full_name),
        locale,
        origin: 'chat',
        replyChannel: 'chat',
        subject: chatSubject(body || (locale === 'en' ? 'Attachment' : 'Вложение')),
        category: input.category ?? null,
        body: text,
        createdAt: now,
      });
      if (!c) return rollback({ ok: false as const, reason: 'notFound' as const });
      ({ ticketId, number, messageId } = c);
      created = true;
    }
    if (input.attachments?.length) await insertAttachments(tx, ticketId, messageId, input.attachments);

    if ((created || reopened) && settings.autoReply.enabled && !isWithinHours(settings, now)) {
      const vars = templateVars(settings, { number, subject: '', contactName: String(user.full_name), locale });
      await insertMessage(tx, {
        ticketId,
        authorKind: 'autoreply',
        channel: 'chat',
        body: renderTemplate(settings.texts[locale].offHours, vars),
        createdAt: new Date(now.getTime() + 1),
      });
    }
    return { ok: true as const, ticketId, number, messageId, created };
  });
}

/** Клиент открыл переписку — всё, что было, прочитано. */
export async function markClientRead(db: Queryable, userId: string, ticketId: string): Promise<void> {
  await db.query(
    `UPDATE support_tickets SET client_last_read_at = now() WHERE id = $1 AND user_id = $2`,
    [ticketId, userId],
  );
}

/** Оценка 1–5 после «решено»: один раз, только своего тикета. */
export async function rateTicket(
  db: Queryable,
  input: { userId: string; ticketId: string; score: number; comment?: string | null },
): Promise<Outcome> {
  if (!Number.isInteger(input.score) || input.score < 1 || input.score > 5) return { ok: false, reason: 'invalidScore' };
  const r = await db.query(
    `UPDATE support_tickets SET csat_score = $3, csat_comment = $4, csat_at = now(), updated_at = now()
      WHERE id = $1 AND user_id = $2 AND status IN ('resolved', 'closed') AND csat_score IS NULL
      RETURNING id`,
    [input.ticketId, input.userId, input.score, input.comment ? sanitizeBody(input.comment).slice(0, 1000) : null],
  );
  if (r.rows.length === 0) {
    const t = await db.query(`SELECT csat_score FROM support_tickets WHERE id = $1 AND user_id = $2`, [
      input.ticketId,
      input.userId,
    ]);
    if (!t.rows[0]) return { ok: false, reason: 'notFound' };
    return { ok: false, reason: t.rows[0].csat_score != null ? 'alreadyRated' : 'invalidTransition' };
  }
  return { ok: true };
}

/* ─── Действия оператора ────────────────────────────────────────────── */

async function emailThread(tx: Queryable, ticketId: string): Promise<{ inReplyTo: string | null; references: string[] }> {
  const r = await tx.query(
    `SELECT id, at FROM (
        SELECT email_message_id AS id, created_at AS at FROM support_messages
         WHERE ticket_id = $1 AND email_message_id IS NOT NULL
        UNION ALL
        SELECT rfc_message_id AS id, created_at AS at FROM outbound_mail
         WHERE ticket_id = $1 AND rfc_message_id IS NOT NULL
      ) x ORDER BY at`,
    [ticketId],
  );
  const ids = r.rows.map((x) => String(x.id));
  const lastClient = await tx.query(
    `SELECT email_message_id FROM support_messages
      WHERE ticket_id = $1 AND author_kind = 'client' AND email_message_id IS NOT NULL
      ORDER BY created_at DESC LIMIT 1`,
    [ticketId],
  );
  return {
    inReplyTo: (lastClient.rows[0]?.email_message_id as string | undefined) ?? ids[ids.length - 1] ?? null,
    references: ids.slice(-20),
  };
}

export async function operatorReply(
  db: PoolLike,
  settings: SupportSettings,
  actor: Actor,
  input: { ticketId: string; body: string; templateKey?: string | null; now?: Date },
): Promise<Outcome<{ messageId: string; mailQueued: boolean }>> {
  if (!supportAccess.worksTickets(actor.role)) return { ok: false, reason: 'forbidden' };
  const body = sanitizeBody(input.body);
  if (!body) return { ok: false, reason: 'emptyBody' };
  const now = input.now ?? new Date();

  return inTransaction<Outcome<{ messageId: string; mailQueued: boolean }>>(db, async (tx) => {
    const t = await lockTicket(tx, input.ticketId);
    if (!t) return rollback({ ok: false as const, reason: 'notFound' as const });
    if (!canActOn(actor, t)) return rollback({ ok: false as const, reason: 'forbidden' as const });
    if (t.status === 'closed' || t.status === 'spam') {
      return rollback({ ok: false as const, reason: 'invalidTransition' as const });
    }
    if (t.reply_channel === 'email' && !settings.channels.email) {
      return rollback({ ok: false as const, reason: 'emailChannelDisabled' as const });
    }
    const messageId = await insertMessage(tx, {
      ticketId: t.id,
      authorKind: 'operator',
      authorOperatorId: actor.operatorId,
      channel: t.reply_channel,
      body,
      templateKey: input.templateKey ?? null,
      createdAt: now,
    });

    let mailQueued = false;
    if (t.reply_channel === 'email') {
      const vars = templateVars(settings, { number: t.number, subject: t.subject, contactName: t.contact_name, locale: t.locale }, actor.displayName);
      const thread = await emailThread(tx, t.id);
      await enqueueMail(tx, {
        purpose: 'support_reply',
        ticketId: t.id,
        messageId,
        to: t.contact_email,
        subject: replySubject(t.subject, t.number),
        bodyText: `${body}\n\n${renderTemplate(settings.texts[t.locale].signature, vars)}`,
        inReplyTo: thread.inReplyTo,
        references: thread.references,
      });
      mailQueued = true;
    }

    await tx.query(
      `UPDATE support_tickets SET status = 'waiting_client', last_operator_message_at = $2, updated_at = $2,
         first_responded_at = COALESCE(first_responded_at, $2), resolved_at = NULL,
         assignee_operator_id = COALESCE(assignee_operator_id, $3)
       WHERE id = $1`,
      [t.id, now, actor.operatorId],
    );
    await notifyClient(tx, t.user_id, 'supportReply', { number: t.number });
    await journal(tx, actor.operatorId, SUPPORT_ACTIONS.replySent, t.id, {
      ticketNumber: t.number,
      messageId,
      sha256: sha256(body),
      channel: t.reply_channel,
      templateKey: input.templateKey ?? null,
      statusFrom: t.status,
      statusTo: 'waiting_client',
    });
    return { ok: true as const, messageId, mailQueued };
  });
}

export async function addInternalNote(
  db: PoolLike,
  actor: Actor,
  input: { ticketId: string; body: string },
): Promise<Outcome<{ messageId: string }>> {
  if (!supportAccess.worksTickets(actor.role)) return { ok: false, reason: 'forbidden' };
  const body = sanitizeBody(input.body);
  if (!body) return { ok: false, reason: 'emptyBody' };
  return inTransaction<Outcome<{ messageId: string }>>(db, async (tx) => {
    const t = await lockTicket(tx, input.ticketId);
    if (!t) return rollback({ ok: false as const, reason: 'notFound' as const });
    if (!canActOn(actor, t)) return rollback({ ok: false as const, reason: 'forbidden' as const });
    const messageId = await insertMessage(tx, {
      ticketId: t.id,
      authorKind: 'operator',
      authorOperatorId: actor.operatorId,
      visibility: 'internal',
      channel: t.reply_channel,
      body,
    });
    await tx.query(`UPDATE support_tickets SET updated_at = now() WHERE id = $1`, [t.id]);
    await journal(tx, actor.operatorId, SUPPORT_ACTIONS.noteAdded, t.id, {
      ticketNumber: t.number,
      messageId,
      sha256: sha256(body),
    });
    return { ok: true as const, messageId };
  });
}

export async function assignTicket(
  db: PoolLike,
  actor: Actor,
  input: { ticketId: string; assigneeId: string | null },
): Promise<Outcome> {
  if (!supportAccess.worksTickets(actor.role)) return { ok: false, reason: 'forbidden' };
  return inTransaction<Outcome>(db, async (tx) => {
    const t = await lockTicket(tx, input.ticketId);
    if (!t) return rollback({ ok: false as const, reason: 'notFound' as const });
    if (!canActOn(actor, t)) return rollback({ ok: false as const, reason: 'forbidden' as const });
    if (input.assigneeId) {
      const op = await tx.query(
        `SELECT role FROM operators WHERE id = $1 AND disabled_at IS NULL AND login NOT LIKE 'system:%'`,
        [input.assigneeId],
      );
      const role = op.rows[0]?.role;
      if (!role || !supportAccess.worksTickets(role as SupportRole)) {
        return rollback({ ok: false as const, reason: 'invalidAssignee' as const });
      }
    }
    if ((t.assignee_operator_id ?? null) === (input.assigneeId ?? null)) return { ok: true as const };
    const status = t.status === 'new' && input.assigneeId ? 'open' : t.status;
    await tx.query(
      `UPDATE support_tickets SET assignee_operator_id = $2, status = $3, updated_at = now() WHERE id = $1`,
      [t.id, input.assigneeId, status],
    );
    await journal(tx, actor.operatorId, SUPPORT_ACTIONS.assigned, t.id, {
      ticketNumber: t.number,
      from: t.assignee_operator_id,
      to: input.assigneeId,
    });
    return { ok: true as const };
  });
}

export async function changeTicketStatus(
  db: PoolLike,
  actor: Actor,
  input: { ticketId: string; to: TicketStatus; reason?: string; blockSender?: boolean; now?: Date },
): Promise<Outcome> {
  if (!supportAccess.worksTickets(actor.role)) return { ok: false, reason: 'forbidden' };
  const reason = (input.reason ?? '').trim();
  if (input.to === 'spam' && !reason) return { ok: false, reason: 'reasonRequired' };
  const now = input.now ?? new Date();
  return inTransaction<Outcome>(db, async (tx) => {
    const t = await lockTicket(tx, input.ticketId);
    if (!t) return rollback({ ok: false as const, reason: 'notFound' as const });
    if (!canActOn(actor, t)) return rollback({ ok: false as const, reason: 'forbidden' as const });
    if (!canTransition(t.status, input.to)) return rollback({ ok: false as const, reason: 'invalidTransition' as const });
    await tx.query(
      `UPDATE support_tickets SET status = $2, updated_at = $3,
         resolved_at = CASE WHEN $2 = 'resolved' THEN $3 WHEN $2 = 'closed' THEN resolved_at ELSE NULL END,
         closed_at = CASE WHEN $2 = 'closed' THEN $3 ELSE NULL END
       WHERE id = $1`,
      [t.id, input.to, now],
    );
    if (input.to === 'resolved') await notifyClient(tx, t.user_id, 'supportResolved', { number: t.number });
    if (input.to === 'spam') {
      await journal(tx, actor.operatorId, SUPPORT_ACTIONS.markedSpam, t.id, {
        ticketNumber: t.number,
        from: t.status,
        basis: reason,
      });
      if (input.blockSender) {
        const ins = await tx.query(
          `INSERT INTO support_blocklist (kind, value, reason, created_by) VALUES ('email', $1, $2, $3)
           ON CONFLICT (kind, lower(value)) DO NOTHING RETURNING id`,
          [t.contact_email, reason, actor.operatorId],
        );
        if (ins.rows[0]) {
          await journal(tx, actor.operatorId, SUPPORT_ACTIONS.blocklistAdded, t.id, {
            ticketNumber: t.number,
            kind: 'email',
            valueSha256: sha256(normalizeEmail(t.contact_email)),
            basis: reason,
          });
        }
      }
    } else {
      await journal(tx, actor.operatorId, SUPPORT_ACTIONS.statusChanged, t.id, {
        ticketNumber: t.number,
        from: t.status,
        to: input.to,
        ...(reason ? { basis: reason } : {}),
      });
    }
    return { ok: true as const };
  });
}

/** Склейка гостевого тикета с клиентом — только с основанием (не молча). */
export async function linkTicketToClient(
  db: PoolLike,
  actor: Actor,
  input: { ticketId: string; userId: string; reason: string },
): Promise<Outcome> {
  if (!supportAccess.worksTickets(actor.role)) return { ok: false, reason: 'forbidden' };
  const reason = input.reason.trim();
  if (!reason) return { ok: false, reason: 'reasonRequired' };
  return inTransaction<Outcome>(db, async (tx) => {
    const t = await lockTicket(tx, input.ticketId);
    if (!t) return rollback({ ok: false as const, reason: 'notFound' as const });
    if (!canActOn(actor, t)) return rollback({ ok: false as const, reason: 'forbidden' as const });
    if (t.user_id) return rollback({ ok: false as const, reason: 'invalidTransition' as const });
    const u = await tx.query(`SELECT id FROM users WHERE id = $1`, [input.userId]);
    if (!u.rows[0]) return rollback({ ok: false as const, reason: 'invalidClient' as const });
    await tx.query(`UPDATE support_tickets SET user_id = $2, updated_at = now() WHERE id = $1`, [t.id, input.userId]);
    await journal(tx, actor.operatorId, SUPPORT_ACTIONS.linkedClient, t.id, {
      ticketNumber: t.number,
      userId: input.userId,
      basis: reason,
    });
    return { ok: true as const };
  });
}

/**
 * Просмотр контекста клиента (комплаенс §3.4). Запись не чаще раза в 30 минут
 * на оператора и тикет — экран перечитывается опросом, журнал не должен
 * захлебнуться повторами одного просмотра.
 */
export async function recordContextView(db: PoolLike, actor: Actor, ticketId: string, userId: string): Promise<boolean> {
  return inTransaction<boolean>(db, async (tx) => {
    const recent = await tx.query(
      `SELECT 1 FROM admin_action_journal
        WHERE action = $1 AND operator_id = $2 AND subject_id = $3 AND occurred_at > now() - interval '30 minutes'
        LIMIT 1`,
      [SUPPORT_ACTIONS.contextViewed, actor.operatorId, ticketId],
    );
    if (recent.rows.length > 0) return false;
    await appendJournalWithinTx(
      {
        operatorId: actor.operatorId,
        action: SUPPORT_ACTIONS.contextViewed,
        subjectKind: 'support_ticket',
        subjectId: ticketId,
        payload: { userId, role: actor.role },
      },
      tx,
    );
    return true;
  });
}

/** Решённые без ответа клиента N дней → закрыты (системный автор журнала). */
export async function autoCloseResolved(db: PoolLike, settings: SupportSettings, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - settings.autoCloseDays * 86_400_000);
  const due = await db.query(
    `SELECT id FROM support_tickets WHERE status = 'resolved' AND resolved_at < $1 ORDER BY resolved_at LIMIT 200`,
    [cutoff],
  );
  let closed = 0;
  for (const row of due.rows) {
    const done = await inTransaction(db, async (tx) => {
      const t = await lockTicket(tx, String(row.id));
      if (!t || t.status !== 'resolved') return false;
      await tx.query(`UPDATE support_tickets SET status = 'closed', closed_at = $2, updated_at = $2 WHERE id = $1`, [t.id, now]);
      await journal(tx, SUPPORT_SYSTEM_OPERATOR, SUPPORT_ACTIONS.autoClosed, t.id, {
        ticketNumber: t.number,
        afterDays: settings.autoCloseDays,
      });
      return true;
    });
    if (done) closed++;
  }
  return closed;
}
